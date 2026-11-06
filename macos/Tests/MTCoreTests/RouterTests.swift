import XCTest
@testable import MTCore

final class RouterTests: XCTestCase {
    func router() -> Router {
        let dir = NSTemporaryDirectory() + "mt-dist-\(UUID().uuidString)"
        try! FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try! "<html>index</html>".write(toFile: dir + "/index.html", atomically: true, encoding: .utf8)
        try! "console.log(1)".write(toFile: dir + "/app.js", atomically: true, encoding: .utf8)
        try! "secret".write(toFile: NSTemporaryDirectory() + "mt-secret.txt", atomically: true, encoding: .utf8)
        return Router(webDir: dir)
    }
    func post(_ r: Router, _ path: String, _ body: String, header: Bool = true) -> HTTPResponse {
        r.handle(HTTPRequest(method: "POST", path: path, headers: header ? ["x-mtranslator": "1"] : [:], body: Data(body.utf8)))
    }

    func testStatic() {
        let r = router()
        XCTAssertEqual(r.handle(HTTPRequest(method: "GET", path: "/")).status, 200)
        let js = r.handle(HTTPRequest(method: "GET", path: "/app.js?v=1"))
        XCTAssertEqual(js.contentType, "text/javascript; charset=utf-8")
        // Application monopage : chemin inconnu → index.html ; /api/ inconnu → 404 ; sortie de dist/ impossible
        XCTAssertEqual(String(decoding: r.handle(HTTPRequest(method: "GET", path: "/nope/page")).body, as: UTF8.self), "<html>index</html>")
        XCTAssertEqual(r.handle(HTTPRequest(method: "GET", path: "/api/unknown")).status, 404)
        let esc = r.handle(HTTPRequest(method: "GET", path: "/../../mt-secret.txt"))
        XCTAssertFalse(String(decoding: esc.body, as: UTF8.self).contains("secret"))
    }

    func testHealth() {
        let h = router().handle(HTTPRequest(method: "GET", path: "/api/health"))
        let o = try! JSONSerialization.jsonObject(with: h.body) as! [String: Any]
        XCTAssertEqual(o["status"] as? String, "ok")
        XCTAssertEqual(o["platform"] as? String, "darwin")
        XCTAssertNotNil(o["version"])
    }

    func testGuardHeaderAndWhitelist() {
        let r = router()
        for p in ["/api/xtcore", "/api/pick-file", "/api/save-text", "/api/translate/batch", "/api/translate/models"] {
            XCTAssertEqual(post(r, p, "{}", header: false).status, 403, p)
        }
        XCTAssertEqual(post(r, "/api/autre", "{}").status, 404)
        XCTAssertEqual(post(r, "/api/xtcore", #"{"args":["rm","-rf","/"]}"#).status, XtCore.find() == nil ? 500 : 400)
        XCTAssertEqual(XtCore.run(args: ["rm"], stdin: nil).status, XtCore.find() == nil ? 500 : 400)
        XCTAssertEqual(XtCore.run(args: [], stdin: nil).status, XtCore.find() == nil ? 500 : 400)
        XCTAssertEqual(XtCore.run(args: ["extract", 5], stdin: nil).status, XtCore.find() == nil ? 500 : 400)
        XCTAssertEqual(post(r, "/api/xtcore", "pas du json").status, 500)
        XCTAssertEqual(XtCore.commands.count, 13)
    }

    func testPickAndSave() {
        let r = router()
        let target = NSTemporaryDirectory() + "mt-save-\(UUID().uuidString).txt"
        r.pickFile = { p in (p["mode"] as? String) == "save" ? target : nil }
        let res = post(r, "/api/save-text", #"{"content":"héllo","defaultName":"a.txt"}"#)
        XCTAssertEqual(res.status, 200)
        XCTAssertEqual(try! String(contentsOfFile: target, encoding: .utf8), "héllo")
        let bin = post(r, "/api/save-text", #"{"base64":"AAEC"}"#)
        XCTAssertEqual(bin.status, 200)
        XCTAssertEqual(try! Data(contentsOf: URL(fileURLWithPath: target)), Data([0, 1, 2]))
        r.pickFile = { _ in nil }
        let cancelled = try! JSONSerialization.jsonObject(with: post(r, "/api/save-text", #"{"content":"x"}"#).body) as! [String: Any]
        XCTAssertTrue(cancelled["path"] is NSNull)
    }

    func testLiveServer() throws {
        let s = LocalServer(router: router())
        let port = try s.start(preferredPort: 0)
        let url = URL(string: "http://127.0.0.1:\(port)/api/health")!
        let (data, resp) = try syncGet(url)
        XCTAssertEqual((resp as! HTTPURLResponse).statusCode, 200)
        XCTAssertEqual((resp as! HTTPURLResponse).value(forHTTPHeaderField: "Cache-Control"), "no-cache, no-store, must-revalidate")
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("\"ok\""))
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/xtcore")!)
        req.httpMethod = "POST"; req.httpBody = Data("{}".utf8)
        let (_, r2) = try syncGet(req)
        XCTAssertEqual((r2 as! HTTPURLResponse).statusCode, 403)
        s.stop()
    }

    func syncGet(_ url: URL) throws -> (Data, URLResponse) { try syncGet(URLRequest(url: url)) }
    func syncGet(_ req: URLRequest) throws -> (Data, URLResponse) {
        let sem = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var out: (Data?, URLResponse?, Error?) = (nil, nil, nil)
        URLSession.shared.dataTask(with: req) { out = ($0, $1, $2); sem.signal() }.resume()
        sem.wait()
        if let e = out.2 { throw e }
        return (out.0!, out.1!)
    }
}
