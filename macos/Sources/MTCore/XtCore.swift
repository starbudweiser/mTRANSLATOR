// Cœur Rust (xtcore) : formats ESP/strings/SST/BSA/PEX et heuristique. Seules les sous-commandes de la liste blanche
// sont lancées ; le binaire est embarqué dans Contents/Resources de l'appli.

import Foundation

public enum XtCore {
    /// Sous-commandes autorisées (identique à XTCORE_COMMANDS de la version Python).
    public static let commands: Set<String> = ["extract", "translate", "apply", "write", "sst", "search", "archive-list",
                                               "archive-extract", "pex", "sst-export", "txt", "txt-translate", "txt-write"]

    /// Chemin du binaire (remplaçable pour les tests) ; sinon Resources de l'appli, sinon build local de core/.
    nonisolated(unsafe) public static var overridePath: String?

    public static func find() -> String? {
        var candidates: [String] = []
        if let o = overridePath { candidates.append(o) }
        if let env = ProcessInfo.processInfo.environment["MTRANSLATOR_XTCORE"] { candidates.append(env) }
        if let res = Bundle.main.resourcePath { candidates.append(res + "/xtcore") }
        // Lancement depuis le dépôt (swift run, essais) : core/target/release/xtcore au-dessus de l'exécutable
        var dir = URL(fileURLWithPath: CommandLine.arguments.first ?? "").deletingLastPathComponent()
        for _ in 0..<8 {
            candidates.append(dir.appendingPathComponent("core/target/release/xtcore").path)
            dir = dir.deletingLastPathComponent()
        }
        candidates.append(FileManager.default.currentDirectoryPath + "/core/target/release/xtcore")
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// Résultat : corps JSON (octets) et état HTTP.
    public struct Result {
        public let body: Data
        public let status: Int
    }

    static func errorBody(_ message: String) -> Data {
        (try? JSONSerialization.data(withJSONObject: ["error": message])) ?? Data()
    }

    /// Lance xtcore avec ces arguments ; 200 (code 0), 422 (code ≠ 0 avec JSON), 500 (sortie illisible), 400 (refusé).
    public static func run(args: Any?, stdin: Any?, timeout: TimeInterval = 600) -> Result {
        guard let exe = find() else {
            return Result(body: errorBody("xtcore introuvable (cargo build --release dans core/)"), status: 500)
        }
        guard let list = args as? [Any], let first = list.first as? String, commands.contains(first),
              list.allSatisfy({ $0 is String }) else {
            return Result(body: errorBody("Commande xtcore refusée"), status: 400)
        }
        let argv = list.map { $0 as! String }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: exe)
        proc.arguments = argv
        let out = Pipe(), err = Pipe(), inp = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        proc.standardInput = (stdin is String) ? inp : FileHandle.nullDevice
        do { try proc.run() } catch {
            return Result(body: errorBody("\(error.localizedDescription)"), status: 500)
        }
        nonisolated(unsafe) var outData = Data(), errData = Data()
        let group = DispatchGroup()
        let queue = DispatchQueue.global()
        group.enter(); queue.async { outData = out.fileHandleForReading.readDataToEndOfFile(); group.leave() }
        group.enter(); queue.async { errData = err.fileHandleForReading.readDataToEndOfFile(); group.leave() }
        if let s = stdin as? String {
            queue.async {
                try? inp.fileHandleForWriting.write(contentsOf: Data(s.utf8))
                try? inp.fileHandleForWriting.close()
            }
        }
        nonisolated(unsafe) var timedOut = false
        let killer = DispatchWorkItem { timedOut = true; proc.terminate() }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
        proc.waitUntilExit()
        killer.cancel()
        group.wait()
        if timedOut {
            return Result(body: errorBody("Command '['\(exe)', '\(first)']' timed out after \(Int(timeout)) seconds"), status: 500)
        }
        if (try? JSONSerialization.jsonObject(with: outData, options: .fragmentsAllowed)) != nil {
            return Result(body: outData, status: proc.terminationStatus == 0 ? 200 : 422)
        }
        let se = String(decoding: errData, as: UTF8.self), so = String(decoding: outData, as: UTF8.self)
        var msg = pyStrip(!se.isEmpty ? se : so)
        if msg.isEmpty { msg = "réponse vide" }
        return Result(body: errorBody(String(msg.unicodeScalars.prefix(2000))), status: 500)
    }

    // MARK: Glossaire officiel

    /// Fichiers SST du jeu de base et des DLC : source du glossaire de noms officiels.
    static let officialSST: Set<String> = ["skyrim", "update", "dawnguard", "dragonborn", "hearthfires", "fallout4", "dlcrobot",
                                           "dlcworkshop01", "dlccoast", "dlcworkshop02", "dlcworkshop03", "dlcnukaworld", "starfield"]
    nonisolated(unsafe) private static var glossaries: [String: Engines.Glossary?] = [:]
    private static let glossaryLock = NSLock()

    /// Glossaire construit depuis les SST officiels du dossier ; mis en cache par dossier.
    public static func officialGlossary(_ dictDir: String?) -> Engines.Glossary? {
        guard let dir = dictDir, !dir.isEmpty else { return nil }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: dir, isDirectory: &isDir), isDir.boolValue else { return nil }
        glossaryLock.lock()
        if let cached = glossaries[dir] { glossaryLock.unlock(); return cached }
        glossaryLock.unlock()
        var entries: [[String: Any]] = []
        let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? []).sorted(by: pyLess)
        for f in files {
            let low = f.lowercased()
            guard low.hasSuffix(".sst") else { continue }
            let base = low.components(separatedBy: "_english_").dropLast().isEmpty ? low
                : low.components(separatedBy: "_english_").dropLast().joined(separator: "_english_")
            guard officialSST.contains(base) else { continue }
            let res = run(args: ["sst", (dir as NSString).appendingPathComponent(f), "--full"], stdin: nil, timeout: 60)
            if res.status == 200, let obj = try? JSONSerialization.jsonObject(with: res.body) as? [String: Any],
               let items = obj["items"] as? [[String: Any]] {
                entries.append(contentsOf: items)
            }
        }
        let g = Engines.buildGlossary(entries)
        glossaryLock.lock(); glossaries[dir] = .some(g); glossaryLock.unlock()
        return g
    }
}
