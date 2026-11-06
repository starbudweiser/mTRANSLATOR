// Moteurs de traduction automatique : port fidèle de python_app/mt_engines.py.
//
// - Google Traduction gratuit (point d'accès « gtx »), plusieurs textes par requête.
// - Gemini (clé API Google AI Studio), consignes adaptées aux jeux Bethesda.
// Les balises Bethesda (<Alias=…>, <font …>, %d, [pagebreak], sauts de ligne…) ne partent jamais chez Google :
// seul le texte entre elles est traduit, puis le texte est recomposé.

import Foundation

// MARK: - Réseau (remplaçable pour les tests)

public struct HTTPResult: Sendable {
    public let status: Int
    public let data: Data
    public init(status: Int, data: Data) { self.status = status; self.data = data }
}

public enum NetError: Error, CustomStringConvertible {
    case http(Int, Data)
    case other(String)
    public var description: String {
        switch self {
        case .http(let c, _): return "HTTP Error \(c)"
        case .other(let m): return m
        }
    }
}

/// Envoi d'une requête : renvoie l'état et le corps, ou lève NetError.other (réseau). Les états ≥ 400 sont rendus tels quels.
public protocol Transport: Sendable {
    func send(url: String, body: Data?, headers: [String: String], timeout: TimeInterval) throws -> HTTPResult
}

public struct URLSessionTransport: Transport {
    public init() {}
    public func send(url: String, body: Data?, headers: [String: String], timeout: TimeInterval) throws -> HTTPResult {
        guard let u = URL(string: url) else { throw NetError.other("URL invalide") }
        var req = URLRequest(url: u, timeoutInterval: timeout)
        req.httpMethod = body == nil ? "GET" : "POST"
        req.httpBody = body
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        let sem = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var result: Result<HTTPResult, Error> = .failure(NetError.other("aucune réponse"))
        let task = URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err { result = .failure(err) }
            else if let http = resp as? HTTPURLResponse { result = .success(HTTPResult(status: http.statusCode, data: data ?? Data())) }
            sem.signal()
        }
        task.resume()
        sem.wait()
        switch result {
        case .success(let r): return r
        case .failure(let e): throw NetError.other((e as? URLError)?.localizedDescription ?? "\(e)")
        }
    }
}

public enum Engines {
    nonisolated(unsafe) public static var transport: any Transport = URLSessionTransport()
    /// Dictionnaire anglais (remplaçable pour les tests) ; chargé une fois.
    nonisolated(unsafe) public static var wordsPath = "/usr/share/dict/words"
    nonisolated(unsafe) private static var wordsCache: Set<String>?
    private static let wordsLock = NSLock()
    public static func resetWords() { wordsLock.lock(); wordsCache = nil; wordsLock.unlock() }

    static let UA = ["User-Agent": "Mozilla/5.0"]
    static let googleURL = "https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl="
    static let googleBudget = 4500
    static let geminiAPI = "https://generativelanguage.googleapis.com/v1beta"

    // MARK: Motifs

    static let TAG = compile(#"<[^<>]*>|\[[^\[\]]*\]|%[-+0-9.]*[a-zA-Z]|\$[A-Za-z_][\#(RX.w)]*|\{[^{}]*\}|\\[nrt]|\r\n|[\r\n\t]"#)
    static let LETTER = compile(RX.letter)
    static let NEWLINE = compile(#"\r\n|[\r\n]|\\n|\[pagebreak\]"#, .caseInsensitive)
    static let PH = compile(#"⟦(\d+)⟧"#)
    static let CAPWORD = compile(#"(?<![\#(RX.w)⟦-])[A-Z][a-z]{2,}(?![\#(RX.w)-])"#)
    static let IDENT = compile(#"^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$"#)
    static let NAME = compile(#"^[A-Z][\#(RX.w)'-]+(?: (?:of |the |de )?[A-Z][\#(RX.w)'-]+){0,3}$"#)
    static let GLOSSARY_RECS: Set<String> = ["LCTN", "WRLD", "CELL", "REGN", "FACT"]

    public static func tagsOf(_ text: String) -> [String] {
        TAG.all(text).map { $0.text }.sorted(by: pyLess)
    }

    // MARK: Découpage

    /// Découpe un texte en morceaux ; renvoie [(est_traduisible, morceau)]. Les espaces de bord restent hors du texte envoyé.
    public static func splitRuns(_ text: String) -> [(Bool, String)] {
        enum Part { case tag(String), text(String) }
        var parts: [Part] = []
        let ns = text as NSString
        var pos = 0
        for m in TAG.all(text) {
            if m.range.location > pos { parts.append(.text(ns.substring(with: NSRange(location: pos, length: m.range.location - pos)))) }
            parts.append(.tag(m.text))
            pos = m.range.location + m.range.length
        }
        if pos < ns.length { parts.append(.text(ns.substring(from: pos))) }
        var out: [(Bool, String)] = []
        for p in parts {
            switch p {
            case .tag(let t): out.append((false, t))
            case .text(let t):
                let core = pyStrip(t)
                if core.isEmpty || !LETTER.found(core) { out.append((false, t)); continue }
                let lead = String(t.unicodeScalars.prefix(pyLen(t) - pyLen(pyLStrip(t))))
                let trail = String(t.unicodeScalars.suffix(pyLen(t) - pyLen(pyRStrip(t))))
                if !lead.isEmpty { out.append((false, lead)) }
                out.append((true, core))
                if !trail.isEmpty { out.append((false, trail)) }
            }
        }
        return out
    }

    // MARK: Glossaire

    public struct Glossary: @unchecked Sendable {
        public let compound: NSRegularExpression?
        public let terms: [PyStr: String]
        public let single: NSRegularExpression?
    }

    /// entries : éléments SST (source, dest, rec, field). Renvoie le glossaire ou nil.
    public static func buildGlossary(_ entries: [[String: Any]]) -> Glossary? {
        var order: [PyStr] = []
        var seen: [PyStr: (order: [PyStr], counts: [PyStr: Int])] = [:]
        for e in entries {
            guard let rec = e["rec"] as? String, GLOSSARY_RECS.contains(rec), (e["field"] as? String) == "FULL",
                  let source = e["source"] as? String, let dest = e["dest"] as? String,
                  NAME.matchesStart(source), !PyStr(source).isEqual(PyStr(dest)) else { continue }
            let k = PyStr(source), d = PyStr(dest)
            if seen[k] == nil { seen[k] = ([], [:]); order.append(k) }
            if seen[k]!.counts[d] == nil { seen[k]!.order.append(d) }
            seen[k]!.counts[d, default: 0] += 1
        }
        var terms: [PyStr: String] = [:]
        var termOrder: [PyStr] = []
        for src in order {
            let c = seen[src]!
            var best = c.order[0]
            for d in c.order where c.counts[d]! > c.counts[best]! { best = d }
            let total = c.counts.values.reduce(0, +)
            if Double(c.counts[best]!) / Double(total) >= 0.6 {
                terms[src] = best.s
                termOrder.append(src)
            }
        }
        if terms.isEmpty { return nil }
        func pattern(_ words: [PyStr]) -> NSRegularExpression? {
            if words.isEmpty { return nil }
            let sorted = words.enumerated().sorted { (a, b) in
                let la = pyLen(a.element.s), lb = pyLen(b.element.s)
                return la != lb ? la > lb : a.offset < b.offset
            }.map { $0.element }
            let alt = sorted.map { NSRegularExpression.escapedPattern(for: $0.s) }.joined(separator: "|")
            return compile(#"(?<![\#(RX.w)'-])(?:\#(alt))(?![\#(RX.w)-]|'(?!s\b))"#)
        }
        return Glossary(compound: pattern(termOrder.filter { $0.s.contains(" ") }), terms: terms,
                        single: pattern(termOrder.filter { !$0.s.contains(" ") }))
    }

    // MARK: Masquage

    /// Remplace les codes en ligne par ⟦n⟧ (Google les garde) ; les noms du glossaire deviennent aussi des marqueurs.
    static func mask(_ line: String, _ glossary: Glossary?) -> (String, [String]) {
        var tags: [String] = []
        if IDENT.matchesStart(line) { return ("⟦0⟧", [line]) }
        var out = TAG.sub(line) { t in tags.append(t); return "⟦\(tags.count - 1)⟧" }
        if let g = glossary, let comp = g.compound {
            out = comp.sub(out) { t in tags.append(g.terms[PyStr(t)] ?? t); return "⟦\(tags.count - 1)⟧" }
        }
        return (out, tags)
    }

    static func unmask(_ text: String, _ tags: [String]) -> String? {
        let found = PH.all(text).compactMap { Int(($0.text as NSString).substring(with: NSRange(location: 1, length: $0.range.length - 2))) }
        if found.sorted() != Array(0..<tags.count) { return nil }
        return PH.sub(text) { t in
            let n = Int(String(t.dropFirst().dropLast())) ?? 0
            return tags[n]
        }
    }

    static func englishWords() -> Set<String> {
        wordsLock.lock(); defer { wordsLock.unlock() }
        if let w = wordsCache { return w }
        var set = Set<String>()
        if let data = FileManager.default.contents(atPath: wordsPath) {
            let text = String(decoding: data, as: UTF8.self)
            for line in text.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" }) {
                set.insert(pyStrip(String(line)).lowercased())
            }
        }
        wordsCache = set
        return set
    }

    static func uniqueInOrder(_ xs: [String]) -> [String] {
        var seen = Set<PyStr>(), out: [String] = []
        for x in xs where seen.insert(PyStr(x)).inserted { out.append(x) }
        return out
    }

    /// Noms propres du mod que Google « corrige » (Aonghus → Angus) : remis à la place du mot le plus proche.
    static func restoreNames(_ src: String, _ destIn: String) -> String {
        let words = englishWords()
        if words.isEmpty { return destIn }
        var dest = destIn
        for name in uniqueInOrder(CAPWORD.all(src).map { $0.text }) {
            let wordRe = compile(#"(?<![\#(RX.w)])\#(NSRegularExpression.escapedPattern(for: name))(?![\#(RX.w)])"#)
            if words.contains(name.lowercased()) || wordRe.found(dest) { continue }
            let cands = uniqueInOrder(CAPWORD.all(dest).map { $0.text }).filter { !pyContains(src, $0) }
            var best: String?, bestRatio = -1.0
            for w in cands {
                let r = sequenceRatio(w.lowercased(), name.lowercased())
                if r > bestRatio { best = w; bestRatio = r }
            }
            if let best, sequenceRatio(best.lowercased(), name.lowercased()) >= 0.7 {
                let re = compile(#"(?<![\#(RX.w)])\#(NSRegularExpression.escapedPattern(for: best))(?![\#(RX.w)])"#)
                dest = re.sub(dest) { _ in name }
            }
        }
        return dest
    }

    /// Noms d'un seul mot laissés en anglais par Google : remplacés par le nom officiel.
    static func rename(_ src: String, _ dest: String, _ glossary: Glossary?) -> String {
        guard let g = glossary, let single = g.single else { return dest }
        let found = Set(single.all(src).map { PyStr($0.text) })
        if found.isEmpty { return dest }
        return single.sub(dest) { t in found.contains(PyStr(t)) ? (g.terms[PyStr(t)] ?? t) : t }
    }

    // MARK: Google

    /// Requête d'un groupe de textes : (URL, corps) — exposée pour comparer avec la version Python.
    static func googleRequest(_ runs: [String], _ tl: String) -> (url: String, body: String) {
        (googleURL + tl, pyURLEncode(runs.map { ("q", $0) }))
    }

    /// Traductions d'un groupe ; un texte déjà dans la langue cible (détection de Google) revient inchangé.
    static func googleChunk(_ runs: [String], _ tl: String) throws -> [String] {
        let req = googleRequest(runs, tl)
        var headers = UA
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        let res = try transport.send(url: req.url, body: Data(req.body.utf8), headers: headers, timeout: 30)
        if res.status >= 400 { throw NetError.http(res.status, res.data) }
        guard let data = try? JSONSerialization.jsonObject(with: res.data) as? [Any] else { throw NetError.other("réponse invalide") }
        var out: [String] = []
        for (r, d) in zip(runs, data) {
            let text: String, lang: String
            if let arr = d as? [Any] {
                guard arr.count >= 2 else { throw NetError.other("index") }
                guard let t = arr[0] as? String else { throw NetError.other("type") }
                text = t
                lang = (arr[1] as? String) ?? ""
            } else if let t = d as? String { text = t; lang = "" }
            else { throw NetError.other("type") }
            out.append(lang == tl ? r : text)
        }
        return out.count == runs.count ? out : []
    }

    /// Traduit des segments uniques par requêtes groupées en parallèle ; segment -> traduction.
    static func googleMany(_ segments: [String], _ tl: String) -> [PyStr: String] {
        let unique = uniqueInOrder(segments)
        var chunks: [[String]] = [], cur: [String] = [], size = 0
        for r in unique {
            if !cur.isEmpty && size + pyLen(r) > googleBudget { chunks.append(cur); cur = []; size = 0 }
            cur.append(r)
            size += pyLen(r)
        }
        if !cur.isEmpty { chunks.append(cur) }
        let lock = NSLock()
        nonisolated(unsafe) var done: [PyStr: String] = [:]
        parallel(chunks.count, workers: 6) { i in
            let chunk = chunks[i]
            if let res = try? googleChunk(chunk, tl), res.count == chunk.count {
                lock.lock(); for (k, v) in zip(chunk, res) { done[PyStr(k)] = v }; lock.unlock()
            }
        }
        return done
    }

    /// Exécute `body(0..<n)` sur au plus `workers` fils.
    static func parallel(_ n: Int, workers: Int, _ body: @escaping @Sendable (Int) -> Void) {
        if n == 0 { return }
        let q = OperationQueue()
        q.maxConcurrentOperationCount = workers
        for i in 0..<n { q.addOperation { body(i) } }
        q.waitUntilAllOperationsAreFinished()
    }

    static func lines(_ text: String) -> [(Bool, String)] {
        var out: [(Bool, String)] = []
        let ns = text as NSString
        var pos = 0
        for m in NEWLINE.all(text) {
            out.append((true, ns.substring(with: NSRange(location: pos, length: m.range.location - pos))))
            out.append((false, m.text))
            pos = m.range.location + m.range.length
        }
        out.append((true, ns.substring(from: pos)))
        return out
    }

    /// Segments masqués que google_batch enverrait à Google pour ces textes (comparaison avec Python).
    public static func maskedSegments(_ texts: [String], glossary: Glossary?) -> [String] {
        var masked: [String] = []
        for t in texts {
            for (isLine, chunk) in lines(t) where isLine {
                let (m, _) = mask(pyStrip(chunk), glossary)
                if LETTER.found(PH.sub(m) { _ in "" }) { masked.append(m) }
            }
        }
        return masked
    }

    /// Traduit une liste de textes ; nil pour un texte non traduit (erreur réseau).
    public static func googleBatch(_ texts: [String], tl: String = "fr", glossary: Glossary? = nil) -> [String?] {
        enum Piece { case lit(String), line(String, [String], String, String) }
        var plan: [[Piece]] = []
        var masked: [String] = []
        for t in texts {
            var parts: [Piece] = []
            for (isLine, chunk) in lines(t) {
                if !isLine { parts.append(.lit(chunk)); continue }
                let (m, tags) = mask(pyStrip(chunk), glossary)
                if !LETTER.found(PH.sub(m) { _ in "" }) { parts.append(.lit(chunk)); continue }
                let lead = String(chunk.unicodeScalars.prefix(pyLen(chunk) - pyLen(pyLStrip(chunk))))
                let trail = String(chunk.unicodeScalars.suffix(pyLen(chunk) - pyLen(pyRStrip(chunk))))
                parts.append(.line(m, tags, lead, trail))
                masked.append(m)
            }
            plan.append(parts)
        }
        let done = googleMany(masked, tl)

        // Secours : ligne dont les marqueurs ont bougé, traduite morceau par morceau entre les balises
        var retry: [PyStr: [String]] = [:]
        for parts in plan {
            for p in parts {
                if case .line(let m, let tags, _, _) = p, let d = done[PyStr(m)], unmask(d, tags) == nil {
                    retry[PyStr(m)] = splitRuns(unmask(m, tags) ?? "").filter { $0.0 }.map { $0.1 }
                }
            }
        }
        var retryList: [String] = []
        for parts in plan {   // ordre de plan : celui des clés de `retry` en Python (insertion)
            for p in parts { if case .line(let m, _, _, _) = p, let rs = retry[PyStr(m)] { retryList.append(contentsOf: rs) } }
        }
        let runs = retry.isEmpty ? [:] : googleMany(retryList, tl)

        var out: [String?] = []
        for (t, parts) in zip(texts, plan) {
            var res: [String]? = []
            for p in parts {
                switch p {
                case .lit(let s): res!.append(s)
                case .line(let m, let tags, let lead, let trail):
                    var line: String? = done[PyStr(m)].flatMap { unmask($0, tags) }
                    if line == nil, let rs = retry[PyStr(m)], rs.allSatisfy({ runs[PyStr($0)] != nil }) {
                        line = splitRuns(unmask(m, tags) ?? "").map { ok, r in ok ? runs[PyStr(r)]! : r }.joined()
                    }
                    guard let line else { res = nil; break }
                    let src = unmask(m, tags) ?? ""
                    res!.append(lead + restoreNames(src, rename(src, line, glossary)) + trail)
                }
                if res == nil { break }
            }
            let hasLine = parts.contains { if case .line = $0 { return true } else { return false } }
            if let res, !hasLine { out.append(t) }
            else if let res { out.append(res.joined()) }
            else { out.append(nil) }
        }
        return out
    }

    // MARK: Gemini

    static func geminiPrompt(game: String, lang: String, texts: [String]) -> String {
        "Tu traduis des textes du jeu \(game) de l'anglais vers le \(lang), pour un mod. "
        + "Respecte la terminologie officielle française de la série (Bordeciel, Blancherive, Solitude, "
        + "Faillaise, Vendeaume, Markarth, Aubétoile, Rougegarde, Brétonne, Elfe des bois…). "
        + "Conserve STRICTEMENT à l'identique toutes les balises et codes : <…>, [pagebreak], %d, %s, $Variables, "
        + "{…}, sauts de ligne. Ne traduis pas l'intérieur des balises. "
        + "Réponds uniquement par un tableau JSON de chaînes, une traduction par texte, dans le même ordre.\n\n"
        + "Textes :\n" + pyJSONList(texts)
    }

    /// Corps JSON de la requête generateContent (json.dumps de Python, ensure_ascii).
    static func geminiBody(_ prompt: String) -> String {
        #"{"contents": [{"parts": [{"text": "# + pyJSONString(prompt, ensureASCII: true)
        + #"}]}], "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}}"#
    }

    static let reasons: [Int: String] = [400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
                                         429: "Too Many Requests", 500: "Internal Server Error", 502: "Bad Gateway",
                                         503: "Service Unavailable", 504: "Gateway Timeout"]

    /// Modèles Gemini utilisables pour générer du texte avec cette clé.
    public static func geminiModels(_ key: String) throws -> [String] {
        let res = try transport.send(url: "\(geminiAPI)/models?pageSize=200&key=\(pyQuote(key))", body: nil, headers: UA, timeout: 15)
        if res.status >= 400 { throw NetError.http(res.status, res.data) }
        guard let obj = try JSONSerialization.jsonObject(with: res.data) as? [String: Any] else { return [] }
        var names: [String] = []
        for m in (obj["models"] as? [[String: Any]]) ?? [] {
            guard let name = m["name"] as? String else { continue }
            if ((m["supportedGenerationMethods"] as? [String]) ?? []).contains("generateContent") {
                names.append(String(name.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).last ?? ""))
            }
        }
        return names.filter { $0.hasPrefix("gemini") && !$0.contains("embedding") && !$0.contains("image")
            && !$0.contains("tts") && !$0.contains("audio") }.sorted { pyLess($1, $0) }
    }

    struct GeminiError: Error, CustomStringConvertible { let description: String }

    static func geminiChunk(_ texts: [String], key: String, model: String, game: String, lang: String) throws -> [String] {
        let body = geminiBody(geminiPrompt(game: game, lang: lang, texts: texts))
        var headers = UA
        headers["Content-Type"] = "application/json"
        let res = try transport.send(url: "\(geminiAPI)/models/\(pyQuote(model)):generateContent?key=\(pyQuote(key))",
                                     body: Data(body.utf8), headers: headers, timeout: 120)
        if res.status >= 400 {
            var msg = ""
            if let o = try? JSONSerialization.jsonObject(with: res.data) as? [String: Any],
               let e = o["error"] as? [String: Any], let m = e["message"] as? String { msg = m }
            throw GeminiError(description: "Gemini \(res.status) : \(msg.isEmpty ? (reasons[res.status] ?? "") : msg)")
        }
        guard let data = try JSONSerialization.jsonObject(with: res.data) as? [String: Any],
              let cands = data["candidates"] as? [[String: Any]], let first = cands.first,
              let content = first["content"] as? [String: Any], let parts = content["parts"] as? [[String: Any]],
              let p0 = parts.first, let text = p0["text"] as? String else { throw GeminiError(description: "réponse Gemini illisible") }
        guard let arr = try JSONSerialization.jsonObject(with: Data(text.utf8), options: .fragmentsAllowed) as? [Any],
              arr.count == texts.count else { throw GeminiError(description: "réponse Gemini incomplète") }
        return arr.map { pyStr($0) }
    }

    /// Traduit avec Gemini ; un texte dont les balises ont changé ressort à nil (repli possible).
    public static func geminiBatch(_ texts: [String], key: String, model: String, game: String = "Skyrim",
                                   lang: String = "français", chunkChars: Int = 6000) -> ([String?], String?) {
        var chunks: [[Int]] = [], cur: [Int] = [], size = 0
        for (i, t) in texts.enumerated() {
            if !cur.isEmpty && (size + pyLen(t) > chunkChars || cur.count >= 40) { chunks.append(cur); cur = []; size = 0 }
            cur.append(i)
            size += pyLen(t)
        }
        if !cur.isEmpty { chunks.append(cur) }
        let lock = NSLock()
        nonisolated(unsafe) var out = [String?](repeating: nil, count: texts.count)
        nonisolated(unsafe) var errors: [String] = []
        parallel(chunks.count, workers: 3) { c in
            let idx = chunks[c]
            do {
                let res = try geminiChunk(idx.map { texts[$0] }, key: key, model: model, game: game, lang: lang)
                for (i, r) in zip(idx, res) where !r.isEmpty {
                    if tagsOf(r).elementsEqual(tagsOf(texts[i]), by: { PyStr($0) == PyStr($1) }) {
                        lock.lock(); out[i] = r; lock.unlock()
                    }
                }
            } catch {
                lock.lock(); errors.append("\(error)"); lock.unlock()
            }
        }
        return (out, errors.first)
    }

    // MARK: Langue cible

    /// Convertit un nom de langue (« Français », « Deutsch », « es »…) en code ISO.
    public static func resolveLangCode(_ target: String?) -> String {
        let l = pyStrip(target ?? "").lowercased()
        if l.hasPrefix("es") || l.contains("espag") || l.contains("spani") { return "es" }
        if l.hasPrefix("de") || l.contains("allem") || l.contains("german") { return "de" }
        if l.hasPrefix("it") || l.contains("ital") { return "it" }
        if l.hasPrefix("pl") || l.contains("polo") || l.contains("polish") { return "pl" }
        if l.hasPrefix("ru") || l.contains("russ") || l.contains("рус") { return "ru" }
        if l.hasPrefix("en") || l.contains("angl") || l.contains("engl") { return "en" }
        return "fr"
    }
}

extension PyStr {
    func isEqual(_ o: PyStr) -> Bool { self == o }
}
