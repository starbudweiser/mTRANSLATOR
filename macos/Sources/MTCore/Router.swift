// Routes du serveur local : mêmes chemins, mêmes réponses et même en-tête de garde que la version Python.

import Foundation

public struct HTTPRequest {
    public var method: String
    public var path: String          // chemin brut, requête comprise
    public var headers: [String: String]  // clés en minuscules
    public var body: Data
    public init(method: String, path: String, headers: [String: String] = [:], body: Data = Data()) {
        self.method = method; self.path = path; self.headers = headers; self.body = body
    }
}

public struct HTTPResponse {
    public var status: Int
    public var contentType: String
    public var body: Data
    public init(status: Int, contentType: String, body: Data) { self.status = status; self.contentType = contentType; self.body = body }
}

public final class Router: @unchecked Sendable {
    public static let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.3.1"
    public static let preferredPort: UInt16 = 47821

    let webDir: String
    /// Sélecteur natif : charge utile → chemin (String), liste de chemins, ou nil. Fourni par l'appli.
    public var pickFile: ([String: Any]) -> Any? = { _ in nil }
    public var log: (String) -> Void = { _ in }

    public init(webDir: String) { self.webDir = webDir }

    // MARK: JSON

    static func json(_ obj: Any, status: Int = 200) -> HTTPResponse {
        let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.withoutEscapingSlashes, .fragmentsAllowed])) ?? Data("{}".utf8)
        return HTTPResponse(status: status, contentType: "application/json; charset=utf-8", body: data)
    }
    static func error(_ message: String, _ status: Int) -> HTTPResponse { json(["error": message], status: status) }

    // MARK: Entrée

    public func handle(_ req: HTTPRequest) -> HTTPResponse {
        switch req.method {
        case "GET", "HEAD": return get(req)
        case "POST": return post(req)
        default: return Router.error("Unsupported method (\(req.method))", 501)
        }
    }

    // MARK: GET

    func get(_ req: HTTPRequest) -> HTTPResponse {
        if req.path == "/api/health" {
            return Router.json(["status": "ok", "version": Router.version, "platform": "darwin", "xtcore": XtCore.find() != nil])
        }
        var raw = req.path.components(separatedBy: "?")[0].components(separatedBy: "#")[0]
        if let file = resolve(raw), !isDirectory(file) { return serve(file) }
        if let file = resolve(raw), isDirectory(file) {
            let index = (file as NSString).appendingPathComponent("index.html")
            if FileManager.default.fileExists(atPath: index) { return serve(index) }
        }
        // Application monopage : tout chemin inconnu (hors /api/) renvoie index.html
        if !req.path.hasPrefix("/api/") { raw = "/index.html"; if let f = resolve(raw) { return serve(f) } }
        return Router.error("File not found", 404)
    }

    /// Chemin disque d'une URL, confiné à dist/ (comme SimpleHTTPRequestHandler.translate_path : « .. » ignoré).
    func resolve(_ urlPath: String) -> String? {
        let decoded = urlPath.removingPercentEncoding ?? urlPath
        var parts: [String] = []
        for c in decoded.split(separator: "/", omittingEmptySubsequences: true) {
            if c == "." { continue }
            if c == ".." { if !parts.isEmpty { parts.removeLast() }; continue }
            parts.append(String(c))
        }
        let full = parts.reduce(webDir) { ($0 as NSString).appendingPathComponent($1) }
        return FileManager.default.fileExists(atPath: full) ? full : nil
    }

    func isDirectory(_ path: String) -> Bool {
        var d: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &d) && d.boolValue
    }

    static let mime: [String: String] = [
        "html": "text/html", "htm": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
        "json": "application/json", "map": "application/json", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "gif": "image/gif", "svg": "image/svg+xml", "webp": "image/webp", "ico": "image/vnd.microsoft.icon",
        "woff": "font/woff", "woff2": "font/woff2", "ttf": "font/ttf", "otf": "font/otf", "wasm": "application/wasm",
        "txt": "text/plain", "xml": "application/xml", "mp3": "audio/mpeg", "mp4": "video/mp4", "webmanifest": "application/manifest+json",
    ]

    func serve(_ file: String) -> HTTPResponse {
        guard let data = FileManager.default.contents(atPath: file) else { return Router.error("File not found", 404) }
        let ext = (file as NSString).pathExtension.lowercased()
        var type = Router.mime[ext] ?? "application/octet-stream"
        if type.hasPrefix("text/") { type += "; charset=utf-8" }
        return HTTPResponse(status: 200, contentType: type, body: data)
    }

    // MARK: POST

    func post(_ req: HTTPRequest) -> HTTPResponse {
        let path = req.path
        let guarded = ["/api/xtcore", "/api/pick-file", "/api/save-text", "/api/translate/batch", "/api/translate/models"]
        guard guarded.contains(path) else { return Router.error("Route inconnue", 404) }
        // En-tête personnalisé : bloque les requêtes envoyées par d'autres sites (pré-vérification CORS).
        guard req.headers["x-mtranslator"] == "1" else { return Router.error("En-tête X-mTRANSLATOR requis", 403) }
        do {
            guard let payload = try JSONSerialization.jsonObject(with: req.body) as? [String: Any] else {
                return Router.error("'list' object has no attribute 'get'", 500)
            }
            switch path {
            case "/api/pick-file":
                let r = pickFile(payload)
                log("sélecteur \((payload["mode"] as? String) ?? "open") : \(r.map { "\($0)" } ?? "None")")
                return Router.json(["path": r ?? NSNull()] as [String: Any])
            case "/api/save-text":
                let saved: Any = try saveText(payload) ?? NSNull()
                return Router.json(["path": saved])
            case "/api/xtcore":
                let res = XtCore.run(args: payload["args"] ?? [], stdin: payload["stdin"])
                if res.status != 200 { log("xtcore \(((payload["args"] as? [Any]) ?? []).prefix(1)) : \(String(String(decoding: res.body, as: UTF8.self).prefix(300)))") }
                return HTTPResponse(status: res.status, contentType: "application/json; charset=utf-8", body: res.body)
            case "/api/translate/models":
                let key = (payload["apiKey"] as? String) ?? ""
                return Router.json(["models": try Engines.geminiModels(key)])
            default:
                return Router.json(Router.translateItems(payload))
            }
        } catch {
            return Router.error("\(error)", 500)
        }
    }

    /// Export texte (SST, TXT, CSV, JSON) : sélecteur d'enregistrement natif, puis écriture.
    func saveText(_ payload: [String: Any]) throws -> String? {
        let dir = (payload["directory"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (NSHomeDirectory() + "/Desktop")
        let chosen = pickFile(["mode": "save", "title": (payload["title"] as? String) ?? "Exporter",
                               "defaultName": (payload["defaultName"] as? String) ?? "export.txt", "directory": dir])
        guard let path = chosen as? String, !path.isEmpty else { return nil }
        if let b64 = payload["base64"] as? String {  // fichier binaire (plugin, archive .zip)
            guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else {
                throw NetError.other("Incorrect padding")
            }
            try data.write(to: URL(fileURLWithPath: path))
            return path
        }
        try Data(((payload["content"] as? String) ?? "").utf8).write(to: URL(fileURLWithPath: path))
        return path
    }

    // MARK: Traduction automatique

    /// Gemini si choisi (avec clé), sinon Google gratuit. Un texte non traduit revient inchangé ; les échecs Gemini sont repris par Google.
    public static func translateItems(_ payload: [String: Any]) -> [String: Any] {
        let items = (payload["items"] as? [[String: Any]]) ?? []
        let texts = items.map { pyStr($0["text"] ?? "") }
        let lang = Engines.resolveLangCode((payload["targetLang"] as? String) ?? "Français")
        let glossary = lang == "fr" ? XtCore.officialGlossary(payload["dict"] as? String) : nil
        var engine = "Google Traduction (gratuit)"
        var warning: Any = NSNull()
        var out = [String?](repeating: nil, count: texts.count)
        let key = pyStrip((payload["apiKey"] as? String) ?? "")
        if (payload["engine"] as? String) == "gemini" && !key.isEmpty {
            let model = ((payload["model"] as? String).flatMap { $0.isEmpty ? nil : $0 }) ?? "gemini-2.5-flash"
            let game = ((payload["gameContext"] as? String).flatMap { $0.isEmpty ? nil : $0 }) ?? "Skyrim"
            let (res, warn) = Engines.geminiBatch(texts, key: key, model: model, game: game)
            out = res
            warning = warn ?? NSNull()
            engine = "Gemini (\(model))"
            if out.contains(where: { $0 == nil }) { engine += " + Google pour le reste" }
        }
        let missing = out.indices.filter { out[$0] == nil }
        if !missing.isEmpty {
            let res = Engines.googleBatch(missing.map { texts[$0] }, tl: lang, glossary: glossary)
            for (i, r) in zip(missing, res) { out[i] = r }
        }
        let translations: [[String: Any]] = zip(items.indices, items).map { i, it in
            ["id": pyStr(it["id"] ?? ""), "translatedText": out[i] ?? texts[i]]
        }
        return ["success": true, "engine": engine, "warning": warning, "translations": translations]
    }
}
