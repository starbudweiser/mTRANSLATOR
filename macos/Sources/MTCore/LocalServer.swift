// Serveur HTTP local, 127.0.0.1 uniquement. Port fixe 47821 : le stockage de l'interface (dictionnaires, base locale)
// est rattaché à l'origine http://127.0.0.1:47821 ; si le port est pris (autre instance), un port libre au hasard.

import Foundation
import Darwin

public final class LocalServer: @unchecked Sendable {
    private let router: Router
    private var fd: Int32 = -1
    public private(set) var port: UInt16 = 0

    public init(router: Router) { self.router = router }

    /// Démarre l'écoute ; renvoie le port réellement utilisé.
    @discardableResult
    public func start(preferredPort: UInt16 = Router.preferredPort) throws -> UInt16 {
        signal(SIGPIPE, SIG_IGN)
        var sock = try Self.bindLoopback(preferredPort)
        if sock < 0 { sock = try Self.bindLoopback(0) }
        guard sock >= 0 else { throw NetError.other("Impossible de démarrer le serveur local.") }
        fd = sock
        var addr = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(sock, $0, &len) } }
        port = UInt16(bigEndian: addr.sin_port)
        let t = Thread { [weak self] in self?.acceptLoop() }
        t.name = "mTRANSLATOR-http"
        t.start()
        return port
    }

    public func stop() { if fd >= 0 { close(fd); fd = -1 } }

    /// -1 si le port est occupé.
    static func bindLoopback(_ port: UInt16) throws -> Int32 {
        let s = socket(AF_INET, SOCK_STREAM, 0)
        guard s >= 0 else { throw NetError.other("socket") }
        var yes: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let ok = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        if ok != 0 { close(s); return -1 }
        listen(s, 128)
        return s
    }

    private func acceptLoop() {
        while fd >= 0 {
            let c = accept(fd, nil, nil)
            if c < 0 { if fd < 0 { return }; continue }
            var one: Int32 = 1
            setsockopt(c, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
            var tv = timeval(tv_sec: 60, tv_usec: 0)
            setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
            DispatchQueue.global(qos: .userInitiated).async { [router] in Self.serve(c, router) }
        }
    }

    // MARK: Une connexion (HTTP/1.0 : une requête, puis fermeture, comme la version Python)

    private static func serve(_ c: Int32, _ router: Router) {
        defer { close(c) }
        guard let req = readRequest(c) else { return }
        let res = router.handle(req)
        let isHead = req.method == "HEAD"
        var head = "HTTP/1.0 \(res.status) \(reason(res.status))\r\n"
        head += "Cache-Control: no-cache, no-store, must-revalidate\r\n"
        head += "Content-Type: \(res.contentType)\r\n"
        head += "Content-Length: \(res.body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        writeAll(c, Data(head.utf8))
        if !isHead { writeAll(c, res.body) }
    }

    static func reason(_ s: Int) -> String {
        switch s {
        case 200: return "OK"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 422: return "Unprocessable Entity"
        case 500: return "Internal Server Error"
        case 501: return "Not Implemented"
        default: return "OK"
        }
    }

    private static func writeAll(_ c: Int32, _ data: Data) {
        data.withUnsafeBytes { (buf: UnsafeRawBufferPointer) in
            var off = 0
            while off < buf.count {
                let n = write(c, buf.baseAddress! + off, buf.count - off)
                if n <= 0 { return }
                off += n
            }
        }
    }

    private static func readRequest(_ c: Int32) -> HTTPRequest? {
        var data = Data()
        var buf = [UInt8](repeating: 0, count: 65536)
        let sep = Data("\r\n\r\n".utf8)
        var headEnd: Range<Data.Index>?
        while headEnd == nil {
            let n = read(c, &buf, buf.count)
            if n <= 0 { return nil }
            data.append(buf, count: n)
            headEnd = data.range(of: sep)
            if data.count > 1_000_000 && headEnd == nil { return nil }
        }
        let head = String(decoding: data[..<headEnd!.lowerBound], as: UTF8.self)
        var lines = head.components(separatedBy: "\r\n")
        let first = lines.removeFirst().split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard first.count >= 2 else { return nil }
        var headers: [String: String] = [:]
        for l in lines {
            guard let i = l.firstIndex(of: ":") else { continue }
            headers[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
        }
        var body = Data(data[headEnd!.upperBound...])
        let want = Int(headers["content-length"] ?? "") ?? 0
        while body.count < want {
            let n = read(c, &buf, min(buf.count, want - body.count))
            if n <= 0 { return nil }
            body.append(buf, count: n)
        }
        return HTTPRequest(method: first[0], path: first[1], headers: headers, body: body)
    }
}
