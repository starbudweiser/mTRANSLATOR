// Point d'entrée de mTRANSLATOR : serveur HTTP local (mêmes routes /api que la version Python), fenêtre WKWebView qui
// affiche l'interface React de Resources/dist, splash animé, menus natifs, mise à jour automatique.
//
// Modes : « mTRANSLATOR --serve [--port N] » = serveur seul, sans fenêtre (préversion Vite, tests).
// Essais en arrière-plan : MTRANSLATOR_QUIET=1 lance l'appli sans prendre le focus.

import AppKit
import MTCore
import SwiftUI

let quiet = ProcessInfo.processInfo.environment["MTRANSLATOR_QUIET"] != nil
let brandColor = Color(red: 0xfb / 255, green: 0xbf / 255, blue: 0x24 / 255)

// Taille de référence de l'interface : tout y tient sur une ligne. En dessous, l'UI se réduit
// proportionnellement (web/src/utils/uiZoom.ts) jusqu'à 85 %, d'où la taille minimale.
let REF_SIZE = NSSize(width: 1480, height: 900)
let MIN_SIZE = NSSize(width: 1260, height: 700)
// Splash animé (règle Socle) : t = 0 splash visible → t = 2 s fenêtre de l'appli (ou dès qu'elle est prête)
// → t = 4 s début de la sortie animée (600 ms), jamais avant que la fenêtre soit affichée.
let SPLASH_SIZE = NSSize(width: 500, height: 190)  // carte de 476 × 166 et marge de 12 px pour son ombre
let SPLASH_MAIN_AT = 2.0, SPLASH_LEAVE_AT = 4.0, SPLASH_LEAVE_S = 0.6

/// Dossier de l'interface compilée (dist/) : Resources de l'appli, sinon dist/ du dépôt.
func findWebDir() -> String? {
    var candidates: [String] = []
    if let env = ProcessInfo.processInfo.environment["MTRANSLATOR_DIST"] { candidates.append(env) }
    if let res = Bundle.main.resourcePath { candidates.append(res + "/dist") }
    var dir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
    for _ in 0..<8 { candidates.append(dir.appendingPathComponent("dist").path); dir = dir.deletingLastPathComponent() }
    return candidates.first { FileManager.default.fileExists(atPath: $0 + "/index.html") }
}

func makeRouter(webDir: String) -> Router {
    let router = Router(webDir: webDir)
    router.log = { Log.write($0) }
    return router
}

// MARK: - Mode serveur seul

let cliArgs = CommandLine.arguments
if cliArgs.contains("--serve") {
    guard let webDir = findWebDir() else {
        FileHandle.standardError.write(Data("[mTRANSLATOR] Interface introuvable : lancez 'npm run build' dans web/.\n".utf8))
        exit(1)
    }
    var wanted = Router.preferredPort
    if let i = cliArgs.firstIndex(of: "--port"), i + 1 < cliArgs.count, let p = UInt16(cliArgs[i + 1]) { wanted = p }
    let server = LocalServer(router: makeRouter(webDir: webDir))
    do {
        let port = try server.start(preferredPort: wanted)
        print("[mTRANSLATOR] Serveur local actif sur : http://127.0.0.1:\(port)")
        fflush(stdout)
        dispatchMain()
    } catch {
        FileHandle.standardError.write(Data("\(error)\n".utf8))
        exit(1)
    }
}

// MARK: - Application

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var config = Config.load()
    var server: LocalServer!
    var origin = ""
    var main: WebHost!
    var mainWindow: NSWindow!
    var splash: WebHost?
    var splashWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Socle.apply()
        // « m » dans la couleur du logo
        Socle.brand("mTRANSLATOR", color: brandColor)
        guard let webDir = findWebDir() else { fail(L("Interface introuvable : lancez 'npm run build' dans web/.")); return }

        let router = makeRouter(webDir: webDir)
        router.pickFile = { payload in
            // Appelé depuis un fil du serveur : le sélecteur vit sur le fil principal
            nonisolated(unsafe) var result: Any?
            DispatchQueue.main.sync { MainActor.assumeIsolated { result = Pickers.pick(payload) } }
            return result
        }
        server = LocalServer(router: router)
        do { origin = "http://127.0.0.1:\(try server.start())" } catch { fail(L("Impossible de démarrer le serveur local.")); return }
        Log.write("serveur : \(origin)")

        buildMenu()
        let lang = I18n.lang
        let version = Router.version

        // Fenêtre principale (cachée jusqu'au splash)
        main = WebHost(origin: origin)
        let screen = NSScreen.screens.first?.frame.size ?? REF_SIZE
        let size = NSSize(width: min(REF_SIZE.width, (screen.width * 0.92).rounded(.down)), height: min(REF_SIZE.height, (screen.height * 0.9).rounded(.down)))
        let minSize = NSSize(width: min(MIN_SIZE.width, size.width), height: min(MIN_SIZE.height, size.height))
        mainWindow = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        mainWindow.title = "mTRANSLATOR"
        mainWindow.contentView = main.webView
        mainWindow.isReleasedWhenClosed = false
        mainWindow.delegate = self
        mainWindow.backgroundColor = NSColor(srgbRed: 0x1e / 255, green: 0x1e / 255, blue: 0x1e / 255, alpha: 1)
        mainWindow.contentMinSize = minSize
        mainWindow.setContentSize(size)
        mainWindow.socleCenter()
        mainWindow.collectionBehavior.insert(.fullScreenPrimary)
        main.load("/?ui=\(lang)")  // langue d'interface lue par web/src/i18n/L.ts

        // Splash animé
        let sp = WebHost(origin: origin, transparent: true)
        splash = sp
        let w = NSWindow(contentRect: NSRect(origin: .zero, size: SPLASH_SIZE), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.contentView = sp.webView
        w.level = quiet ? .normal : .floating
        w.socleCenter()
        splashWindow = w
        sp.load("/splash.html?lang=\(lang)&v=\(version)")
        runSplash(sp)

        UpdateEngine.shared.configure(repo: "mTRANSLATOR", lang: { I18n.lang })
        UpdateEngine.shared.start()  // nouvelle version ? (au plus une fois par jour)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { UpdateEngine.shared.installAppMenuItem() }
    }

    func fail(_ message: String) {
        let a = NSAlert()
        a.messageText = message
        a.runModal()
        NSApp.terminate(nil)
    }

    // MARK: Splash

    private func showWindow(_ w: NSWindow) {
        if quiet { w.orderBack(nil) } else { w.orderFrontRegardless() }
    }

    private func runSplash(_ sp: WebHost) {
        var splashLoaded = false, mainLoaded = false
        var started = false
        let t0 = Date()
        func showMain(waited: Double) {
            // fenêtre dès que l'interface est chargée (30 s au plus)
            if !mainLoaded && waited < 30 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { showMain(waited: waited + 0.1) }
                return
            }
            if !mainLoaded { Log.write("splash : interface lente, fenêtre affichée quand même") }
            if quiet { mainWindow.orderBack(nil) } else { mainWindow.makeKeyAndOrderFront(nil); NSApp.activate() }
            Log.write(String(format: "splash : fenêtre affichée à %.2f s", Date().timeIntervalSince(t0)))
            let wait = max(0, SPLASH_LEAVE_AT - Date().timeIntervalSince(t0))
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [self] in
                Log.write(String(format: "splash : sortie à %.2f s", Date().timeIntervalSince(t0)))
                sp.js("window.splashLeave && window.splashLeave()")
                DispatchQueue.main.asyncAfter(deadline: .now() + SPLASH_LEAVE_S + 0.05) { [self] in
                    splashWindow?.close()
                    splashWindow = nil
                    splash = nil
                    Log.write(String(format: "splash : fermé à %.2f s", Date().timeIntervalSince(t0)))
                }
            }
        }
        let begin = { [self] in
            guard !started else { return }
            started = true
            showWindow(splashWindow!)
            Log.write("splash : affiché")
            DispatchQueue.main.asyncAfter(deadline: .now() + SPLASH_MAIN_AT) { showMain(waited: 0) }
        }
        sp.onLoaded = { splashLoaded = true; begin() }
        main.onLoaded = { [self] in
            mainLoaded = true
            // Essais : MTRANSLATOR_TEST_DROP=<fichier> simule le dépôt de ce fichier (même appel que le glisser-déposer)
            if let path = ProcessInfo.processInfo.environment["MTRANSLATOR_TEST_DROP"], let d = try? JSONSerialization.data(withJSONObject: path, options: .fragmentsAllowed) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { main.js("window.mtranslatorDropPath && window.mtranslatorDropPath(\(String(decoding: d, as: UTF8.self)))") }
            }
        }
        // Splash lent à charger : affiché quand même au bout d'une seconde
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { _ = splashLoaded; begin() }
    }

    // MARK: Fenêtre

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func windowWillClose(_ notification: Notification) {
        if (notification.object as? NSWindow) === mainWindow { NSApp.terminate(nil) }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { .terminateNow }

    func applicationWillTerminate(_ notification: Notification) { server?.stop() }

    // MARK: Menus

    @objc func chooseLanguage(_ sender: NSMenuItem) {
        let choice = Config.normalize(sender.representedObject as? String)
        config["language"] = choice
        Config.save(config)
        let code = I18n.setLang(Config.resolve(choice))
        buildMenu()
        UpdateEngine.shared.installAppMenuItem()
        main?.js("window.mtranslatorSetUiLang && window.mtranslatorSetUiLang(\"\(code)\")")
    }

    @objc func showAbout(_ sender: Any?) { About.show() }

    /// Chaque entrée appelle window.mtranslatorMenu('<action>') (pont défini dans web/src/App.tsx).
    @objc func webAction(_ sender: NSMenuItem) {
        guard let action = sender.representedObject as? String else { return }
        main?.js("window.mtranslatorMenu && window.mtranslatorMenu('\(action)')")
    }

    private func buildMenu() {
        let bar = NSMenu()

        // Menu de l'appli : pas de couleur dans les menus, le nom de l'appli y est en texte normal
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: L("À propos de mTRANSLATOR"), action: #selector(showAbout), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("Masquer mTRANSLATOR"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = appMenu.addItem(withTitle: L("Masquer les autres"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: L("Tout afficher"), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("Quitter mTRANSLATOR"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        bar.addItem(submenuItem(appMenu))

        func action(_ menu: NSMenu, _ title: String, _ name: String) {
            let item = menu.addItem(withTitle: L(title), action: #selector(webAction), keyEquivalent: "")
            item.target = self
            item.representedObject = name
        }
        func titled(_ title: String, _ fill: (NSMenu) -> Void) -> NSMenuItem {
            let m = NSMenu(title: L(title))
            fill(m)
            return submenuItem(m)
        }

        bar.addItem(titled("Fichier") { m in
            action(m, "Ouvrir un fichier…  (⌘O)", "open")
            action(m, "Enregistrer  (⌘S)", "save")
            let export = NSMenuItem(title: L("Exporter"), action: nil, keyEquivalent: "")
            let sub = NSMenu(title: L("Exporter"))
            action(sub, "Dictionnaire SST (.sst)", "exportSST")
            action(sub, "Texte MCM (.txt)", "exportTXT")
            action(sub, "Tableur (.csv)", "exportCSV")
            action(sub, "JSON (.json)", "exportJSON")
            action(sub, "Plugin traduit (.esp / .esm)…", "exportESP")
            export.submenu = sub
            m.addItem(export)
            m.addItem(.separator())
            action(m, "Traduction par lots…", "batch")
            m.addItem(.separator())
            action(m, "Fermer le fichier", "close")
        })

        // Édition : copier / coller dans les champs de l'interface
        bar.addItem(titled("Édition") { m in
            m.addItem(withTitle: L("Couper"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
            m.addItem(withTitle: L("Copier"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
            m.addItem(withTitle: L("Coller"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
            m.addItem(withTitle: L("Tout sélectionner"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        })

        bar.addItem(titled("Traduction") { m in
            action(m, "Traduire…", "translate")
            action(m, "Valider et passer au suivant  (F10)", "validateNext")
            action(m, "Rechercher et remplacer…", "findReplace")
            m.addItem(.separator())
            action(m, "Annuler la dernière modification", "undo")
        })

        bar.addItem(titled("Outils") { m in
            action(m, "Dictionnaires…", "dictionaries")
            action(m, "Statistiques…", "stats")
            action(m, "Comparer les versions…", "diff")
        })

        // Présentation : plein écran
        bar.addItem(titled("Présentation") { m in
            let fs = m.addItem(withTitle: L("Plein écran"), action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
            fs.keyEquivalentModifierMask = [.command, .control]
        })

        // Menu « Langue » : Automatique + 4 langues, coche sur le choix courant
        bar.addItem(titled("Langue") { m in
            let current = Config.choice(config)
            func add(_ title: String, _ code: String) {
                let item = m.addItem(withTitle: title, action: #selector(chooseLanguage), keyEquivalent: "")
                item.target = self
                item.representedObject = code
                item.state = code == current ? .on : .off
            }
            add(L("Automatique (système)"), Config.auto)
            m.addItem(.separator())
            for (code, label) in Config.menuLangs { add(label, code) }
        })

        let win = titled("Fenêtre") { m in
            m.addItem(withTitle: L("Réduire"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        }
        bar.addItem(win)

        NSApp.mainMenu = bar
        NSApp.windowsMenu = win.submenu
    }

    private func submenuItem(_ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem()
        item.submenu = menu
        return item
    }
}

I18n.setLang(Config.resolve(Config.choice(Config.load())))

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
}
