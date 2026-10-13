#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mTRANSLATOR - Application native de traduction pour mods Bethesda
Skyrim Special Edition, Fallout 4, Starfield.

Lanceur de l'application compilée : sert l'interface Web (dist/) sur un port
local et l'affiche dans une fenêtre native WebKit (pywebview).
Moteur de traduction : Google Translate haute vitesse sans clé requise.
"""

import os
import sys
import json
import threading
import http.server
import socketserver
import subprocess
import webbrowser
import time
import urllib.parse
import urllib.request

VERSION = '2.5.0'


def ensure_web_assets() -> str:
    """Localise l'interface Web compilée (dist/index.html)."""
    candidates = []
    if getattr(sys, 'frozen', False):
        meipass = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        candidates += [
            os.path.join(meipass, 'dist'),
            os.path.join(meipass, 'Resources', 'dist'),
            meipass,
        ]
    here = os.path.dirname(os.path.abspath(__file__))
    candidates += [os.path.join(here, 'dist'), os.path.join(here, '..', 'dist')]

    for candidate in candidates:
        if os.path.exists(os.path.join(candidate, 'index.html')):
            return os.path.abspath(candidate)

    raise SystemExit("[mTRANSLATOR] Interface introuvable : lancez 'npm run build' dans web/.")


BETESDA_GLOSSARY = {
    'Iron Sword': 'Épée de fer',
    'Steel War Axe': "Hache d'armes d'acier",
    'Health': 'Santé',
    'Magicka': 'Magie',
    'Stamina': 'Vigueur',
    'Dragonborn': 'Enfant de dragon',
    'Whiterun': 'Blancherive',
    'Solitude': 'Solitude',
    'Riften': 'Faillaise',
    'Windhelm': 'Vendeaume',
    'Markarth': 'Markarth',
    'Dawnstar': 'Aubétoile',
    'Falkreath': 'Épervine',
    'Morthal': 'Morthal',
    'Winterhold': 'Fortdhiver',
    'Stimpack': 'Stimpack',
    'Diamond City': 'Diamond City',
    'The Lodge': 'La Loge',
    'New Atlantis': 'New Atlantis',
    'Armor': 'Armure',
    'Shield': 'Bouclier',
    'Helmet': 'Casque',
    'Boots': 'Bottes',
    'Dagger': 'Dague',
    'Bow': 'Arc',
    'Arrow': 'Flèche',
    'Spell': 'Sort',
    'Book': 'Livre',
    'Gold': 'Or',
}


def resolve_lang_code(target_lang: str = 'fr') -> str:
    """Convertit un nom de langue ('Français', 'Deutsch', 'es'...) en code ISO."""
    l = (target_lang or '').lower().strip()
    if l.startswith('es') or 'espag' in l or 'spani' in l:
        return 'es'
    if l.startswith('de') or 'allem' in l or 'german' in l:
        return 'de'
    if l.startswith('it') or 'ital' in l:
        return 'it'
    if l.startswith('pl') or 'polo' in l or 'polish' in l:
        return 'pl'
    if l.startswith('ru') or 'russ' in l or 'рус' in l:
        return 'ru'
    if l.startswith('en') or 'angl' in l or 'engl' in l:
        return 'en'
    return 'fr'


def translate_google_gtx(text: str, target_lang: str = 'fr') -> str:
    """Moteur Google Translate sans clé, avec repli sur le glossaire Bethesda."""
    if not text or not text.strip():
        return text
    try:
        lang_code = resolve_lang_code(target_lang)
        query = urllib.parse.quote(text)
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={lang_code}&dt=t&q={query}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                translated = ''.join(chunk[0] for chunk in data[0] if chunk and chunk[0])
                # Protection de [pagebreak]
                if '[pagebreak]' in text.lower():
                    translated = (translated.replace('[saut de page]', '[pagebreak]')
                                  .replace('[sautdepage]', '[pagebreak]')
                                  .replace('[interruzione]', '[pagebreak]'))
                return translated
    except Exception:
        pass
    return BETESDA_GLOSSARY.get(text.strip(), text)


def create_mtranslator_handler(web_directory: str):
    class MTranslatorRequestHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=web_directory, **kwargs)

        def log_message(self, format, *args):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            super().end_headers()

        def send_json(self, payload, status=200):
            data = json.dumps(payload).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == '/api/health':
                self.send_json({'status': 'ok', 'version': VERSION, 'platform': sys.platform})
                return

            file_path = os.path.join(web_directory, self.path.split('?')[0].lstrip('/'))
            if not os.path.exists(file_path) and not self.path.startswith('/api/'):
                self.path = '/index.html'
            super().do_GET()

        def do_POST(self):
            if self.path != '/api/translate/batch':
                self.send_json({'error': 'Route inconnue'}, 404)
                return
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                payload = json.loads(self.rfile.read(content_length).decode('utf-8'))
                target_lang = payload.get('targetLang', 'Français')
                results = [
                    {'id': str(item.get('id', '')),
                     'translatedText': translate_google_gtx(item.get('text', ''), target_lang)}
                    for item in payload.get('items', [])
                ]
                self.send_json({
                    'success': True,
                    'translations': results,
                    'engine': 'Google Translate (Haute Vitesse)',
                })
            except Exception as e:
                self.send_json({'error': str(e)}, 500)

    return MTranslatorRequestHandler


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True  # relance immédiate sur le même port (stockage conservé)


# Port fixe : le stockage de l'interface (dictionnaires, base locale) est rattaché à l'adresse
# http://127.0.0.1:<port>. Un port différent à chaque lancement le rendrait introuvable.
PREFERRED_PORT = 47821
STORAGE_DIR = os.path.join(os.path.expanduser('~/Library/Application Support'), 'mTRANSLATOR', 'webview')


def run_local_server(web_dir: str) -> int:
    handler = create_mtranslator_handler(web_dir)
    try:
        httpd = ThreadingServer(('127.0.0.1', PREFERRED_PORT), handler)
    except OSError:
        # Port déjà pris (autre instance ouverte) : port libre au hasard
        httpd = ThreadingServer(('127.0.0.1', 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


# Menus standard de macOS fournis par pywebview, en français
MENU_FR = {
    'global.quitConfirmation': 'Voulez-vous vraiment quitter ?', 'global.ok': 'OK', 'global.quit': 'Quitter',
    'global.cancel': 'Annuler', 'global.saveFile': 'Enregistrer le fichier',
    'cocoa.menu.about': 'À propos de', 'cocoa.menu.services': 'Services', 'cocoa.menu.view': 'Présentation',
    'cocoa.menu.edit': 'Édition', 'cocoa.menu.hide': 'Masquer', 'cocoa.menu.hideOthers': 'Masquer les autres',
    'cocoa.menu.showAll': 'Tout afficher', 'cocoa.menu.quit': 'Quitter', 'cocoa.menu.fullscreen': 'Plein écran',
    'cocoa.menu.cut': 'Couper', 'cocoa.menu.copy': 'Copier', 'cocoa.menu.paste': 'Coller',
    'cocoa.menu.selectAll': 'Tout sélectionner',
}


def build_menu(webview):
    """Menus macOS natifs : chaque entrée déclenche l'action correspondante de l'interface
    (pont window.mtranslatorMenu défini dans web/src/App.tsx)."""
    from webview.menu import Menu, MenuAction, MenuSeparator

    def call(action: str):
        def run():
            if webview.windows:
                webview.windows[0].evaluate_js(f"window.mtranslatorMenu && window.mtranslatorMenu('{action}')")
        return run

    def item(title: str, action: str):
        return MenuAction(title, call(action))

    return [
        Menu('Fichier', [
            item('Ouvrir un fichier…  (⌘O)', 'open'),
            item('Enregistrer  (⌘S)', 'save'),
            Menu('Exporter', [
                item('Dictionnaire SST (.sst)', 'exportSST'),
                item('Texte MCM (.txt)', 'exportTXT'),
                item('Tableur (.csv)', 'exportCSV'),
                item('JSON (.json)', 'exportJSON'),
                item('Plugin traduit (.esp / .esm)…', 'exportESP'),
            ]),
            MenuSeparator(),
            item('Traitement par lots…', 'batch'),
            MenuSeparator(),
            item('Fermer le fichier', 'close'),
        ]),
        Menu('Traduction', [
            item('Traduire…', 'translate'),
            item('Valider et passer au suivant  (F10)', 'validateNext'),
            item('Rechercher et remplacer…', 'findReplace'),
            MenuSeparator(),
            item('Annuler la dernière modification', 'undo'),
        ]),
        Menu('Outils', [
            item('Dictionnaires…', 'dictionaries'),
            item('Statistiques…', 'stats'),
            item('Comparer les versions…', 'diff'),
        ]),
        Menu('Aide', [
            item('À propos de mTRANSLATOR', 'about'),
        ]),
    ]


def launch_native_window(app_url: str):
    try:
        import webview
        print("[mTRANSLATOR] Moteur natif WebKit activé.")
        webview.create_window(
            title='mTRANSLATOR',
            url=app_url,
            width=1380,
            height=880,
            min_size=(1200, 720),
            background_color='#1e1e1e',
            text_select=True,
            zoomable=True,
        )
        os.makedirs(STORAGE_DIR, exist_ok=True)
        webview.start(
            debug=False,
            menu=build_menu(webview),
            private_mode=False,  # conserver dictionnaires et base locale d'un lancement à l'autre
            storage_path=STORAGE_DIR,
            localization=MENU_FR,
        )
        return
    except ImportError:
        pass

    browser_paths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    for p in browser_paths:
        if os.path.exists(p):
            print("[mTRANSLATOR] Lancement en mode fenêtre application...")
            subprocess.Popen([p, f"--app={app_url}", '--window-size=1380,880'])
            break
    else:
        print("[mTRANSLATOR] Ouverture de l'interface dans votre navigateur...")
        webbrowser.open(app_url)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nArrêt de mTRANSLATOR.")


def main():
    print("=========================================================")
    print(f"  mTRANSLATOR v{VERSION} - Traducteur de mods Bethesda")
    print("=========================================================")
    web_dir = ensure_web_assets()
    port = run_local_server(web_dir)
    app_url = f"http://127.0.0.1:{port}"
    print(f"[mTRANSLATOR] Serveur local actif sur : {app_url}")
    launch_native_window(app_url)


if __name__ == '__main__':
    main()
