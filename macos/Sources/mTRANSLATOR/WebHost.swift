// Fenêtre de l'interface : WKWebView qui affiche http://127.0.0.1:<port> (origine du stockage de l'utilisateur),
// avec les boîtes de dialogue JavaScript, le choix de fichiers des <input type="file">, les téléchargements et
// le glisser-déposer qui transmet les chemins complets à l'interface.

import AppKit
import MTCore
import UniformTypeIdentifiers
import WebKit

/// WKWebView qui, au dépôt de fichiers, transmet leurs chemins complets à l'interface
/// (window.mtranslatorDropPath / mtranslatorDropPaths) : le DOM, lui, ne les donne pas.
final class DropWebView: WKWebView {
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = (sender.draggingPasteboard.readObjects(forClasses: [NSURL.self],
                    options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
        let paths = urls.map { $0.path }
        let ok = super.performDragOperation(sender)
        if !paths.isEmpty {
            // Après l'évènement `drop` de la page (qui arme son repli de lecture) : sinon le fichier s'ouvrirait deux fois
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                let list = (try? JSONSerialization.data(withJSONObject: paths)).map { String(decoding: $0, as: UTF8.self) } ?? "[]"
                let js = paths.count > 1
                    ? "window.mtranslatorDropPaths && window.mtranslatorDropPaths(\(list))"
                    : "window.mtranslatorDropPath && window.mtranslatorDropPath(\((try? JSONSerialization.data(withJSONObject: paths[0], options: .fragmentsAllowed)).map { String(decoding: $0, as: UTF8.self) } ?? "\"\""))"
                self?.evaluateJavaScript(js)
                Log.write("dépôt : \(paths)")
            }
        }
        return ok
    }
}

@MainActor
final class WebHost: NSObject, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
    let webView: DropWebView
    var onLoaded: (() -> Void)?
    private let origin: String

    init(origin: String, transparent: Bool = false) {
        self.origin = origin
        let config = WKWebViewConfiguration()
        // Magasin par défaut : c'est là que sont les dictionnaires et la base locale de l'utilisateur
        config.websiteDataStore = .default()
        webView = DropWebView(frame: .zero, configuration: config)
        super.init()
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsMagnification = false  // le zoom est géré par l'interface (⌘+ / ⌘− / ⌘0)
        webView.allowsBackForwardNavigationGestures = false
        if transparent { webView.setValue(false, forKey: "drawsBackground") }
        else { webView.underPageBackgroundColor = NSColor(srgbRed: 0x1e / 255, green: 0x1e / 255, blue: 0x1e / 255, alpha: 1) }
        if ProcessInfo.processInfo.environment["MTRANSLATOR_DEBUG"] != nil { webView.isInspectable = true }
    }

    func load(_ path: String) { webView.load(URLRequest(url: URL(string: origin + path)!)) }

    func js(_ code: String) { webView.evaluateJavaScript(code) }

    // MARK: Navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { onLoaded?() }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { return decisionHandler(.download) }
        if let url = navigationAction.request.url, let scheme = url.scheme, ["http", "https", "mailto"].contains(scheme),
           !(url.absoluteString.hasPrefix(origin)) {
            NSWorkspace.shared.open(url)  // lien externe : navigateur du Mac
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    // MARK: Téléchargements (<a download>, blob:) : sélecteur d'enregistrement natif

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping @MainActor (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let url = panel.url else { return completionHandler(nil) }
        try? FileManager.default.removeItem(at: url)  // le panneau a déjà confirmé le remplacement
        completionHandler(url)
    }

    // MARK: Boîtes de dialogue JavaScript

    private func alert(_ message: String, buttons: [String]) -> NSApplication.ModalResponse {
        let a = NSAlert()
        a.messageText = message
        for b in buttons { a.addButton(withTitle: b) }
        return a.runModal()
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor () -> Void) {
        _ = alert(message, buttons: [L("OK")])
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor (Bool) -> Void) {
        completionHandler(alert(message, buttons: [L("OK"), L("Annuler")]) == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        let a = NSAlert()
        a.messageText = prompt
        a.addButton(withTitle: L("OK"))
        a.addButton(withTitle: L("Annuler"))
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        completionHandler(a.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    // <input type="file"> : sélecteur natif
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }
}

/// Journal ~/Library/Logs/mTRANSLATOR.log (comme la version Python). Jamais de clé d'API ni de contenu des textes.
enum Log {
    static let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/mTRANSLATOR.log")
    static let lock = NSLock()
    static func write(_ msg: String) {
        lock.lock(); defer { lock.unlock() }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        guard let data = "\(f.string(from: Date())) \(msg)\n".data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(data); try? h.close()
        } else {
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url)
        }
    }
}

/// Sélecteurs de fichiers natifs pour /api/pick-file.
@MainActor
enum Pickers {
    /// Extensions d'une liste « Description (*.a;*.b) » ; nil = tous les fichiers.
    static func extensions(_ fileTypes: [String]) -> [String]? {
        var exts: [String] = []
        for t in fileTypes {
            guard let l = t.lastIndex(of: "("), let r = t.lastIndex(of: ")"), l < r else { return nil }
            for part in t[t.index(after: l)..<r].split(separator: ";") {
                let e = part.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "*.", with: "")
                if e == "*" || e.isEmpty { return nil }
                exts.append(e)
            }
        }
        return exts.isEmpty ? nil : exts
    }

    static func pick(_ payload: [String: Any]) -> Any? {
        let mode = (payload["mode"] as? String) ?? "open"
        let multiple = (payload["multiple"] as? Bool ?? false) && mode == "open"
        let title = payload["title"] as? String
        let name = (payload["defaultName"] as? String) ?? ""
        let dir = (payload["directory"] as? String) ?? ""
        var isDir: ObjCBool = false
        let dirURL = FileManager.default.fileExists(atPath: dir, isDirectory: &isDir) && isDir.boolValue ? URL(fileURLWithPath: dir) : nil
        if !quiet { NSApp.activate() }  // le panneau doit être au premier plan : l'utilisateur vient de cliquer dans l'appli
        if mode == "save" {
            let p = NSSavePanel()
            if let title { p.message = title }
            p.nameFieldStringValue = name
            p.directoryURL = dirURL
            p.canCreateDirectories = true
            return p.runModal() == .OK ? p.url?.path : nil
        }
        let p = NSOpenPanel()
        if let title { p.message = title }
        p.directoryURL = dirURL
        if mode == "folder" {
            p.canChooseDirectories = true; p.canChooseFiles = false; p.canCreateDirectories = true
        } else {
            p.canChooseFiles = true; p.canChooseDirectories = false
            p.allowsMultipleSelection = multiple
            if let exts = extensions((payload["fileTypes"] as? [String]) ?? []) {
                p.allowedContentTypes = exts.compactMap { UTType(filenameExtension: $0) }
            }
        }
        guard p.runModal() == .OK else { return nil }
        return multiple ? p.urls.map { $0.path } : p.url?.path
    }
}
