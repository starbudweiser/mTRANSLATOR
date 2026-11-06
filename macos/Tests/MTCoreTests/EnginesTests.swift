// Compare le port Swift de mt_engines.py aux sorties de référence de la version Python (Fixtures/engines_ref.json,
// généré par Tests/gen_reference.py) : mêmes segments, mêmes requêtes construites, mêmes résultats. Réseau simulé.

import XCTest
@testable import MTCore

final class FakeTransport: Transport, @unchecked Sendable {
    let lock = NSLock()
    var requests: [[String?]] = []

    func send(url: String, body: Data?, headers: [String: String], timeout: TimeInterval) throws -> HTTPResult {
        let b = body.map { String(decoding: $0, as: UTF8.self) }
        lock.lock(); requests.append([url, b]); lock.unlock()
        func js(_ o: Any) -> Data { try! JSONSerialization.data(withJSONObject: o, options: .withoutEscapingSlashes) }
        if url.contains("translate.googleapis.com") {
            var out: [[String]] = []
            for pair in (b ?? "").split(separator: "&") {
                let q = String(pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)[1])
                    .replacingOccurrences(of: "+", with: " ").removingPercentEncoding!
                if q.hasPrefix("FR:") { out.append(["~" + q + "~", "fr"]) }
                else if q.contains("BREAK") {
                    let re = try! NSRegularExpression(pattern: "⟦\\d+⟧")
                    out.append(["~" + re.stringByReplacingMatches(in: q, range: NSRange(location: 0, length: (q as NSString).length), withTemplate: "") + "~", "en"])
                } else {
                    out.append([("~" + q + "~").replacingOccurrences(of: "Aonghus", with: "Angus").replacingOccurrences(of: "Maliq", with: "Malik"), "en"])
                }
            }
            return HTTPResult(status: 200, data: js(out))
        }
        if url.contains(":generateContent") {
            let key = url.components(separatedBy: "key=")[1]
            if key == "badkey" { return HTTPResult(status: 429, data: js(["error": ["message": "quota"]])) }
            let obj = try JSONSerialization.jsonObject(with: Data(b!.utf8)) as! [String: Any]
            let prompt = (((obj["contents"] as! [[String: Any]])[0]["parts"] as! [[String: Any]])[0]["text"]) as! String
            let items = try JSONSerialization.jsonObject(with: Data(prompt.components(separatedBy: "Textes :\n")[1].utf8)) as! [String]
            let res = items.map { $0.contains("DROP") ? Engines.TAG.sub($0) { _ in "" } : "G:" + $0 }
            let text = String(decoding: js(res), as: UTF8.self)
            return HTTPResult(status: 200, data: js(["candidates": [["content": ["parts": [["text": text]]]]]]))
        }
        if url.contains("/models?") {
            func m(_ n: String, _ g: String) -> [String: Any] { ["name": "models/" + n, "supportedGenerationMethods": [g]] }
            return HTTPResult(status: 200, data: js(["models": [m("gemini-2.5-flash", "generateContent"), m("gemini-2.5-pro", "generateContent"),
                m("gemini-embedding-001", "generateContent"), m("text-bison", "generateContent"), m("gemini-old", "embedContent"),
                m("gemini-1.5-flash", "generateContent")]]))
        }
        throw NetError.other("inconnu")
    }
    func sorted() -> [[String?]] { requests.sorted { ($0[0]! + ($0[1] ?? "")) < ($1[0]! + ($1[1] ?? "")) } }
    func reset() { requests = [] }
}

final class EnginesTests: XCTestCase {
    static let ref: [String: Any] = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/engines_ref.json")
        return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }()
    var ref: [String: Any] { Self.ref }
    var texts: [String] { ref["texts"] as! [String] }
    let fake = FakeTransport()

    override func setUp() { Engines.transport = fake; fake.reset() }

    func glossary() -> Engines.Glossary? { Engines.buildGlossary(ref["glossary_entries"] as! [[String: Any]]) }

    func testResolveLang() {
        for (k, v) in ref["resolve_lang"] as! [String: String] { XCTAssertEqual(Engines.resolveLangCode(k), v, k) }
    }

    func testSplitRunsAndTags() {
        let sr = ref["split_runs"] as! [[[Any]]]
        let tg = ref["tags_of"] as! [[String]]
        for (i, t) in texts.enumerated() {
            let got = Engines.splitRuns(t).map { [$0.0 as Any, $0.1 as Any] }
            XCTAssertEqual(got.count, sr[i].count, t)
            for (a, b) in zip(got, sr[i]) { XCTAssertEqual(a[0] as? Bool, b[0] as? Bool, t); XCTAssertEqual(a[1] as? String, b[1] as? String, t) }
            XCTAssertEqual(Engines.tagsOf(t), tg[i], t)
        }
    }

    func testGlossary() {
        let g = glossary()!
        let terms = ref["glossary_terms"] as! [String: String]
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: g.terms.map { ($0.key.s, $0.value) }), terms)
        // Mêmes noms composés et simples : motifs équivalents (comparés par leur comportement sur des phrases)
        XCTAssertNotNil(g.compound); XCTAssertNotNil(g.single)
    }

    func testMasked() {
        let m = ref["masked"] as! [String: [[Any]]]
        // Masquage ligne par ligne, avec le strip de Python
        for (label, gl) in [("none", nil), ("gloss", glossary())] as [(String, Engines.Glossary?)] {
            var idx = 0
            for t in texts { for (isLine, l) in Engines.lines(t) where isLine {
                let (a, b) = Engines.mask(pyStrip(l), gl)
                let exp = m[label]![idx]
                XCTAssertEqual(a, exp[0] as? String, "\(label) \(t)")
                XCTAssertEqual(b, exp[1] as? [String], "\(label) \(t)")
                idx += 1
            } }
        }
    }

    func testGoogleBatch() {
        let all = ref["google"] as! [String: [String: Any]]
        for (label, gl, tl) in [("fr_none", nil, "fr"), ("fr_gloss", glossary(), "fr"), ("es_none", nil, "es")] as [(String, Engines.Glossary?, String)] {
            fake.reset()
            let out = Engines.googleBatch(texts, tl: tl, glossary: gl)
            let exp = all[label]!["out"] as! [Any]
            XCTAssertEqual(out.count, exp.count)
            for (i, (a, b)) in zip(out, exp).enumerated() { XCTAssertEqual(a, b as? String, "\(label) #\(i) \(texts[i])") }
            let reqs = (all[label]!["requests"] as! [[Any]]).map { $0.map { $0 as? String } }
            XCTAssertEqual(fake.sorted(), reqs, label)
        }
    }

    func testRestoreAndRename() {
        for r in ref["restore"] as! [[String]] { XCTAssertEqual(Engines.restoreNames(r[0], r[1]), r[2], r[0]) }
        for r in ref["rename"] as! [[String]] { XCTAssertEqual(Engines.rename(r[0], r[1], glossary()), r[2], r[0]) }
    }

    func testSequenceRatio() {
        for r in ref["seq_ratio"] as! [[Any]] { XCTAssertEqual(sequenceRatio(r[0] as! String, r[1] as! String), r[2] as! Double, accuracy: 1e-12) }
    }

    func testGemini() throws {
        let g = ref["gemini"] as! [String: [String: Any]]
        for (label, key, game) in [("ok", "k3y", "Skyrim"), ("bad", "badkey", "Fallout 4"), ("big", "k3y", "Skyrim")] {
            fake.reset()
            let c = g[label]!
            let ts = c["texts"] as! [String]
            let (out, warn) = Engines.geminiBatch(ts, key: key, model: "gemini-2.5-flash", game: game)
            XCTAssertEqual(out, (c["out"] as! [Any]).map { $0 as? String }, label)
            XCTAssertEqual(warn, c["warning"] as? String, label)
            let reqs = (c["requests"] as! [[Any]]).map { $0.map { $0 as? String } }
            XCTAssertEqual(fake.sorted(), reqs, label)
        }
        fake.reset()
        XCTAssertEqual(try Engines.geminiModels("k/3 y"), (g["models"]!["out"] as! [String]))
        XCTAssertEqual(fake.requests, (g["models"]!["requests"] as! [[Any]]).map { $0.map { $0 as? String } })
    }
}
