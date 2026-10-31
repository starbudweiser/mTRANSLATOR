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

import mt_engines
import update_check

VERSION = '1.3.0'  # version unique de l'appli (lue par build_app.sh ; web/package.json identique)


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


# Cœur Rust (xtcore) : formats ESP/strings/SST/BSA/PEX et heuristique. Sous-commandes autorisées.
XTCORE_COMMANDS = {'extract', 'translate', 'apply', 'write', 'sst', 'search', 'archive-list', 'archive-extract', 'pex',
                   'sst-export', 'txt', 'txt-translate', 'txt-write'}


def find_xtcore():
    """Binaire xtcore : embarqué dans l'app compilée, sinon build local de core/."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [os.path.join(getattr(sys, '_MEIPASS', here), 'xtcore'),
                  os.path.join(here, '..', 'core', 'target', 'release', 'xtcore')]
    return next((c for c in candidates if os.path.isfile(c) and os.access(c, os.X_OK)), None)


def run_xtcore(args, stdin=None, timeout=600):
    exe = find_xtcore()
    if not exe:
        return {'error': 'xtcore introuvable (cargo build --release dans core/)'}, 500
    if not args or args[0] not in XTCORE_COMMANDS or not all(isinstance(a, str) for a in args):
        return {'error': 'Commande xtcore refusée'}, 400
    proc = subprocess.run([exe, *args], input=stdin if isinstance(stdin, str) else None,
                          capture_output=True, text=True, timeout=timeout)
    try:
        return json.loads(proc.stdout), (200 if proc.returncode == 0 else 422)
    except json.JSONDecodeError:
        return {'error': (proc.stderr or proc.stdout or 'réponse vide').strip()[:2000]}, 500


def _osascript_pick(mode, title, default_name, directory, multiple=False):
    """Sélecteur natif via AppleScript (mode serveur seul, sans fenêtre pywebview)."""
    q = lambda v: '"' + v.replace('\\', '\\\\').replace('"', '\\"') + '"'
    loc = f' default location (POSIX file {q(directory)})' if directory and os.path.isdir(directory) else ''
    if mode == 'folder':
        cmd = f'choose folder with prompt {q(title)}{loc}'
    elif mode == 'save':
        cmd = f'choose file name with prompt {q(title)} default name {q(default_name or "")}{loc}'
    elif multiple:
        script = (f'set l to (choose file with prompt {q(title)}{loc} with multiple selections allowed)\n'
                  'set o to ""\nrepeat with f in l\nset o to o & POSIX path of f & linefeed\nend repeat\nreturn o')
        proc = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
        return [x for x in proc.stdout.splitlines() if x] or None
    else:
        cmd = f'choose file with prompt {q(title)}{loc}'
    proc = subprocess.run(['osascript', '-e', f'POSIX path of ({cmd})'], capture_output=True, text=True)
    return proc.stdout.strip() or None


def pick_file(payload):
    """Chemin choisi dans un sélecteur natif (ouvrir, enregistrer, dossier) ; None si annulé.
    Avec `multiple` (ouverture seulement) : liste de chemins."""
    mode = payload.get('mode', 'open')
    multiple = bool(payload.get('multiple')) and mode == 'open'
    title = payload.get('title') or 'mTRANSLATOR'
    default_name = payload.get('defaultName') or ''
    directory = payload.get('directory') or ''
    try:
        import webview
        if MAIN_WINDOW:
            kind = {'save': webview.SAVE_DIALOG, 'folder': webview.FOLDER_DIALOG}.get(mode, webview.OPEN_DIALOG)
            types = tuple(payload.get('fileTypes') or ()) if mode == 'open' else ()
            res = MAIN_WINDOW.create_file_dialog(kind, directory=directory if os.path.isdir(directory) else '',
                                                 save_filename=default_name, file_types=types,
                                                 allow_multiple=multiple)
            if not res:
                return None
            if multiple:
                return [res] if isinstance(res, str) else list(res)
            return res if isinstance(res, str) else res[0]
    except ImportError:
        pass
    return _osascript_pick(mode, title, default_name, directory, multiple)


def save_text(payload):
    """Export texte (SST, TXT, CSV, JSON) : WebKit n'enregistre pas les téléchargements <a download>
    et affiche le fichier à la place de l'app ; on passe donc par un sélecteur natif."""
    path = pick_file({'mode': 'save', 'title': payload.get('title') or 'Exporter',
                      'defaultName': payload.get('defaultName') or 'export.txt',
                      'directory': payload.get('directory') or os.path.expanduser('~/Desktop')})
    if not path:
        return None
    if 'base64' in payload:  # fichier binaire (plugin, archive .zip)
        import base64
        with open(path, 'wb') as f:
            f.write(base64.b64decode(payload['base64']))
        return path
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(payload.get('content', ''))
    return path


# Fichiers SST du jeu de base et des DLC : source du glossaire de noms officiels
OFFICIAL_SST = {'skyrim', 'update', 'dawnguard', 'dragonborn', 'hearthfires', 'fallout4', 'dlcrobot',
                'dlcworkshop01', 'dlccoast', 'dlcworkshop02', 'dlcworkshop03', 'dlcnukaworld', 'starfield'}
_glossaries = {}


def official_glossary(dict_dir):
    if not dict_dir or not os.path.isdir(dict_dir):
        return None
    if dict_dir not in _glossaries:
        entries = []
        for f in sorted(os.listdir(dict_dir)):
            base = f.lower().rsplit('_english_', 1)[0] if f.lower().endswith('.sst') else ''
            if base in OFFICIAL_SST:
                res, status = run_xtcore(['sst', os.path.join(dict_dir, f), '--full'], timeout=60)
                if status == 200:
                    entries.extend(res.get('items', []))
        _glossaries[dict_dir] = mt_engines.build_glossary(entries)
    return _glossaries[dict_dir]


def translate_items(payload):
    """Traduction automatique : Gemini si choisi (avec clé), sinon Google gratuit. Un texte non traduit
    revient inchangé ; les échecs Gemini sont repris par Google."""
    items = payload.get('items', [])
    texts = [str(it.get('text', '')) for it in items]
    lang = resolve_lang_code(payload.get('targetLang', 'Français'))
    glossary = official_glossary(payload.get('dict')) if lang == 'fr' else None
    engine, warning = 'Google Traduction (gratuit)', None
    out = [None] * len(texts)
    key = (payload.get('apiKey') or '').strip()
    if payload.get('engine') == 'gemini' and key:
        model = payload.get('model') or 'gemini-2.5-flash'
        out, warning = mt_engines.gemini_batch(texts, key, model, game=payload.get('gameContext') or 'Skyrim')
        engine = f'Gemini ({model})'
        if any(o is None for o in out):
            engine += ' + Google pour le reste'
    missing = [i for i, o in enumerate(out) if o is None]
    if missing:
        res = mt_engines.google_batch([texts[i] for i in missing], tl=lang, glossary=glossary)
        for i, r in zip(missing, res):
            out[i] = r
    return {
        'success': True,
        'engine': engine,
        'warning': warning,
        'translations': [{'id': str(it.get('id', '')), 'translatedText': o if o is not None else t}
                         for it, o, t in zip(items, out, texts)],
    }


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
                self.send_json({'status': 'ok', 'version': VERSION, 'platform': sys.platform,
                                'xtcore': bool(find_xtcore())})
                return

            file_path = os.path.join(web_directory, self.path.split('?')[0].lstrip('/'))
            if not os.path.exists(file_path) and not self.path.startswith('/api/'):
                self.path = '/index.html'
            super().do_GET()

        def do_POST(self):
            if self.path in ('/api/xtcore', '/api/pick-file', '/api/save-text', '/api/ui-lang'):
                # En-tête personnalisé : bloque les requêtes envoyées par d'autres sites (pré-vérification CORS).
                if self.headers.get('X-mTRANSLATOR') != '1':
                    self.send_json({'error': 'En-tête X-mTRANSLATOR requis'}, 403)
                    return
                try:
                    content_length = int(self.headers.get('Content-Length', 0))
                    payload = json.loads(self.rfile.read(content_length).decode('utf-8'))
                    if self.path == '/api/pick-file':
                        path = pick_file(payload)
                        log(f"sélecteur {payload.get('mode', 'open')} : {path!r}")
                        self.send_json({'path': path})
                        return
                    if self.path == '/api/ui-lang':
                        save_ui_lang(payload.get('lang', ''))
                        self.send_json({'ok': True})
                        return
                    if self.path == '/api/save-text':
                        self.send_json({'path': save_text(payload)})
                        return
                    result, status = run_xtcore(payload.get('args', []), payload.get('stdin'))
                    if status != 200:
                        log(f"xtcore {payload.get('args', [])[:1]} : {result.get('error')}")
                    self.send_json(result, status)
                except Exception as e:
                    self.send_json({'error': str(e)}, 500)
                return
            if self.path not in ('/api/translate/batch', '/api/translate/models'):
                self.send_json({'error': 'Route inconnue'}, 404)
                return
            if self.headers.get('X-mTRANSLATOR') != '1':
                self.send_json({'error': 'En-tête X-mTRANSLATOR requis'}, 403)
                return
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                payload = json.loads(self.rfile.read(content_length).decode('utf-8'))
                if self.path == '/api/translate/models':
                    self.send_json({'models': mt_engines.gemini_models(payload.get('apiKey', ''))})
                    return
                self.send_json(translate_items(payload))
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


def run_local_server(web_dir: str, port: int = PREFERRED_PORT) -> int:
    handler = create_mtranslator_handler(web_dir)
    try:
        httpd = ThreadingServer(('127.0.0.1', port), handler)
    except OSError:
        # Port déjà pris (autre instance ouverte) : port libre au hasard
        httpd = ThreadingServer(('127.0.0.1', 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


# Langue des menus natifs : celle choisie dans l'interface (mémorisée par /api/ui-lang),
# sinon la langue du Mac. Appliquée au lancement suivant (les menus sont construits au démarrage).
UI_LANGS = ('fr', 'en', 'it', 'es')
UI_LANG_FILE = os.path.join(os.path.expanduser('~/Library/Application Support'), 'mTRANSLATOR', 'ui_lang')


def save_ui_lang(code: str):
    if code in UI_LANGS:
        os.makedirs(os.path.dirname(UI_LANG_FILE), exist_ok=True)
        with open(UI_LANG_FILE, 'w', encoding='utf-8') as f:
            f.write(code)


def menu_lang() -> str:
    try:
        with open(UI_LANG_FILE, encoding='utf-8') as f:
            code = f.read().strip()
        if code in UI_LANGS:
            return code
    except OSError:
        pass
    try:
        from Foundation import NSLocale
        for lang in NSLocale.preferredLanguages():
            if str(lang)[:2] in UI_LANGS:
                return str(lang)[:2]
    except Exception:
        pass
    return 'en'


# Titres des menus : {texte français: (anglais, italien, espagnol)}
MENU_TEXTS = {
    'Fichier': ('File', 'File', 'Archivo'),
    'Ouvrir un fichier…  (⌘O)': ('Open a file…  (⌘O)', 'Apri un file…  (⌘O)', 'Abrir un archivo…  (⌘O)'),
    'Enregistrer  (⌘S)': ('Save  (⌘S)', 'Salva  (⌘S)', 'Guardar  (⌘S)'),
    'Exporter': ('Export', 'Esporta', 'Exportar'),
    'Dictionnaire SST (.sst)': ('SST dictionary (.sst)', 'Dizionario SST (.sst)', 'Diccionario SST (.sst)'),
    'Texte MCM (.txt)': ('MCM text (.txt)', 'Testo MCM (.txt)', 'Texto MCM (.txt)'),
    'Tableur (.csv)': ('Spreadsheet (.csv)', 'Foglio di calcolo (.csv)', 'Hoja de cálculo (.csv)'),
    'JSON (.json)': ('JSON (.json)', 'JSON (.json)', 'JSON (.json)'),
    'Plugin traduit (.esp / .esm)…': ('Translated plugin (.esp / .esm)…', 'Plugin tradotto (.esp / .esm)…', 'Plugin traducido (.esp / .esm)…'),
    'Traduction par lots…': ('Batch translation…', 'Traduzione in batch…', 'Traducción por lotes…'),
    'Fermer le fichier': ('Close file', 'Chiudi il file', 'Cerrar el archivo'),
    'Traduction': ('Translation', 'Traduzione', 'Traducción'),
    'Traduire…': ('Translate…', 'Traduci…', 'Traducir…'),
    'Valider et passer au suivant  (F10)': ('Validate and go to next  (F10)', 'Convalida e passa al successivo  (F10)', 'Validar y pasar al siguiente  (F10)'),
    'Rechercher et remplacer…': ('Find and replace…', 'Trova e sostituisci…', 'Buscar y reemplazar…'),
    'Annuler la dernière modification': ('Undo last change', "Annulla l'ultima modifica", 'Deshacer el último cambio'),
    'Outils': ('Tools', 'Strumenti', 'Herramientas'),
    'Dictionnaires…': ('Dictionaries…', 'Dizionari…', 'Diccionarios…'),
    'Statistiques…': ('Statistics…', 'Statistiche…', 'Estadísticas…'),
    'Comparer les versions…': ('Compare versions…', 'Confronta le versioni…', 'Comparar versiones…'),
    'Aide': ('Help', 'Aiuto', 'Ayuda'),
    'À propos de mTRANSLATOR': ('About mTRANSLATOR', 'Informazioni su mTRANSLATOR', 'Acerca de mTRANSLATOR'),
}
MENU_LANG = menu_lang()


def M(text: str) -> str:
    if MENU_LANG == 'fr':
        return text
    return MENU_TEXTS.get(text, (text,) * 3)[UI_LANGS.index(MENU_LANG) - 1]


# Menus standard de macOS fournis par pywebview (en anglais par défaut)
MENU_LOCALIZATION = {'fr': {
    'global.quitConfirmation': 'Voulez-vous vraiment quitter ?', 'global.ok': 'OK', 'global.quit': 'Quitter',
    'global.cancel': 'Annuler', 'global.saveFile': 'Enregistrer le fichier',
    'cocoa.menu.about': 'À propos de', 'cocoa.menu.services': 'Services', 'cocoa.menu.view': 'Présentation',
    'cocoa.menu.edit': 'Édition', 'cocoa.menu.hide': 'Masquer', 'cocoa.menu.hideOthers': 'Masquer les autres',
    'cocoa.menu.showAll': 'Tout afficher', 'cocoa.menu.quit': 'Quitter', 'cocoa.menu.fullscreen': 'Plein écran',
    'cocoa.menu.cut': 'Couper', 'cocoa.menu.copy': 'Copier', 'cocoa.menu.paste': 'Coller',
    'cocoa.menu.selectAll': 'Tout sélectionner',
}, 'it': {
    'global.quitConfirmation': 'Vuoi davvero uscire?', 'global.ok': 'OK', 'global.quit': 'Esci',
    'global.cancel': 'Annulla', 'global.saveFile': 'Salva il file',
    'cocoa.menu.about': 'Informazioni su', 'cocoa.menu.services': 'Servizi', 'cocoa.menu.view': 'Vista',
    'cocoa.menu.edit': 'Modifica', 'cocoa.menu.hide': 'Nascondi', 'cocoa.menu.hideOthers': 'Nascondi altre',
    'cocoa.menu.showAll': 'Mostra tutte', 'cocoa.menu.quit': 'Esci', 'cocoa.menu.fullscreen': 'Schermo intero',
    'cocoa.menu.cut': 'Taglia', 'cocoa.menu.copy': 'Copia', 'cocoa.menu.paste': 'Incolla',
    'cocoa.menu.selectAll': 'Seleziona tutto',
}, 'es': {
    'global.quitConfirmation': '¿Seguro que quieres salir?', 'global.ok': 'OK', 'global.quit': 'Salir',
    'global.cancel': 'Cancelar', 'global.saveFile': 'Guardar el archivo',
    'cocoa.menu.about': 'Acerca de', 'cocoa.menu.services': 'Servicios', 'cocoa.menu.view': 'Visualización',
    'cocoa.menu.edit': 'Edición', 'cocoa.menu.hide': 'Ocultar', 'cocoa.menu.hideOthers': 'Ocultar otros',
    'cocoa.menu.showAll': 'Mostrar todo', 'cocoa.menu.quit': 'Salir', 'cocoa.menu.fullscreen': 'Pantalla completa',
    'cocoa.menu.cut': 'Cortar', 'cocoa.menu.copy': 'Copiar', 'cocoa.menu.paste': 'Pegar',
    'cocoa.menu.selectAll': 'Seleccionar todo',
}}


def build_menu(webview):
    """Menus macOS natifs : chaque entrée déclenche l'action correspondante de l'interface
    (pont window.mtranslatorMenu défini dans web/src/App.tsx)."""
    from webview.menu import Menu, MenuAction, MenuSeparator

    def call(action: str):
        def run():
            if MAIN_WINDOW:
                MAIN_WINDOW.evaluate_js(f"window.mtranslatorMenu && window.mtranslatorMenu('{action}')")
        return run

    def item(title: str, action: str):
        return MenuAction(M(title), call(action))

    return [
        Menu(M('Fichier'), [
            item('Ouvrir un fichier…  (⌘O)', 'open'),
            item('Enregistrer  (⌘S)', 'save'),
            Menu(M('Exporter'), [
                item('Dictionnaire SST (.sst)', 'exportSST'),
                item('Texte MCM (.txt)', 'exportTXT'),
                item('Tableur (.csv)', 'exportCSV'),
                item('JSON (.json)', 'exportJSON'),
                item('Plugin traduit (.esp / .esm)…', 'exportESP'),
            ]),
            MenuSeparator(),
            item('Traduction par lots…', 'batch'),
            MenuSeparator(),
            item('Fermer le fichier', 'close'),
        ]),
        Menu(M('Traduction'), [
            item('Traduire…', 'translate'),
            item('Valider et passer au suivant  (F10)', 'validateNext'),
            item('Rechercher et remplacer…', 'findReplace'),
            MenuSeparator(),
            item('Annuler la dernière modification', 'undo'),
        ]),
        Menu(M('Outils'), [
            item('Dictionnaires…', 'dictionaries'),
            item('Statistiques…', 'stats'),
            item('Comparer les versions…', 'diff'),
        ]),
        Menu(M('Aide'), [
            item('À propos de mTRANSLATOR', 'about'),
        ]),
    ]


def watch_drops(window):
    """Fichiers glissés dans la fenêtre : pywebview fournit leur chemin complet, transmis à
    l'interface (window.mtranslatorDropPath) pour une ouverture par xtcore depuis le disque ;
    plusieurs fichiers vont à window.mtranslatorDropPaths (traitement par lots)."""
    from webview.dom import DOMEventHandler

    def on_drop(event):
        files = event.get('dataTransfer', {}).get('files', [])
        log(f"dépôt : {[(f.get('name'), f.get('pywebviewFullPath')) for f in files]}")
        paths = [f['pywebviewFullPath'] for f in files if f.get('pywebviewFullPath')]
        if len(paths) > 1:
            window.evaluate_js(f"window.mtranslatorDropPaths && window.mtranslatorDropPaths({json.dumps(paths)})")
        elif paths:
            window.evaluate_js(f"window.mtranslatorDropPath && window.mtranslatorDropPath({json.dumps(paths[0])})")

    try:
        window.dom.document.events.drop += DOMEventHandler(on_drop, True, False)
        log('glisser-déposer : écoute active')
    except Exception as e:
        log(f'glisser-déposer indisponible : {e!r}')


LOG_FILE = os.path.expanduser('~/Library/Logs/mTRANSLATOR.log')


def log(msg: str):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError:
        pass


# Taille de référence de l'interface : tout y tient sur une ligne. En dessous, l'UI se réduit
# proportionnellement (web/src/utils/uiZoom.ts) jusqu'à 85 %, d'où la taille minimale.
REF_SIZE = (1480, 900)
MIN_SIZE = (1260, 700)


def window_size(webview):
    """Taille de référence si l'écran principal le permet, sinon 92 % × 90 % de l'écran."""
    try:
        screen = webview.screens[0]
        sw, sh = screen.width, screen.height
    except Exception:
        return REF_SIZE, MIN_SIZE
    size = (min(REF_SIZE[0], int(sw * 0.92)), min(REF_SIZE[1], int(sh * 0.9)))
    return size, (min(MIN_SIZE[0], size[0]), min(MIN_SIZE[1], size[1]))


# Splash animé (règle Socle) : t = 0 splash visible → t = 2 s fenêtre de l'appli (ou dès qu'elle est
# prête) → t = 4 s début de la sortie animée (600 ms), jamais avant que la fenêtre soit affichée.
SPLASH_SIZE = (500, 190)  # carte de 476 × 166 et marge de 12 px pour son ombre
SPLASH_MAIN_AT = 2.0
SPLASH_LEAVE_AT = 4.0
SPLASH_LEAVE_MS = 600
MAIN_WINDOW = None  # fenêtre de l'appli (webview.windows[0] est le splash pendant le lancement)


def run_splash(splash, window, splash_loaded, main_loaded, main_shown):
    splash_loaded.wait(1.0)  # au-delà, on l'affiche quand même
    splash.show()
    t0 = time.monotonic()
    log('splash : affiché')
    time.sleep(SPLASH_MAIN_AT)
    if not main_loaded.wait(30):
        log('splash : interface lente, fenêtre affichée quand même')
    window.show()
    main_shown.wait(5)
    log(f'splash : fenêtre affichée à {time.monotonic() - t0:.2f} s')
    time.sleep(max(0.0, SPLASH_LEAVE_AT - (time.monotonic() - t0)))
    log(f'splash : sortie à {time.monotonic() - t0:.2f} s')
    try:
        splash.evaluate_js('window.splashLeave && window.splashLeave()')
    except Exception:
        pass
    time.sleep(SPLASH_LEAVE_MS / 1000 + 0.05)
    splash.destroy()
    log(f'splash : fermé à {time.monotonic() - t0:.2f} s')


def launch_native_window(app_url: str):
    global MAIN_WINDOW
    try:
        import webview
        (width, height), min_size = window_size(webview)
        print("[mTRANSLATOR] Moteur natif WebKit activé.")
        splash = webview.create_window(
            title='mTRANSLATOR',
            url=f'{app_url}/splash.html?lang={MENU_LANG}&v={VERSION}',
            width=SPLASH_SIZE[0],
            height=SPLASH_SIZE[1],
            resizable=False,
            frameless=True,
            easy_drag=False,
            transparent=True,
            on_top=True,
            focus=False,
            hidden=True,
            background_color='#000000',
        )
        window = MAIN_WINDOW = webview.create_window(
            title='mTRANSLATOR',
            url=app_url,
            width=width,
            height=height,
            min_size=min_size,
            background_color='#1e1e1e',
            text_select=True,
            zoomable=False,  # le zoom est géré par l'interface (⌘+ / ⌘− / ⌘0)
            hidden=True,  # affichée par run_splash
        )
        splash_loaded, main_loaded, main_shown = threading.Event(), threading.Event(), threading.Event()
        splash.events.loaded += splash_loaded.set
        window.events.loaded += main_loaded.set
        window.events.shown += main_shown.set
        window.events.loaded += lambda: watch_drops(window)
        window.events.shown += lambda: update_check.start_webview(window, 'mTRANSLATOR', lang=MENU_LANG)  # nouvelle version ?
        os.makedirs(STORAGE_DIR, exist_ok=True)
        webview.start(
            run_splash, (splash, window, splash_loaded, main_loaded, main_shown),
            debug=False,
            menu=build_menu(webview),
            private_mode=False,  # conserver dictionnaires et base locale d'un lancement à l'autre
            storage_path=STORAGE_DIR,
            localization=MENU_LOCALIZATION.get(MENU_LANG),
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
    # --serve [--port N] : serveur seul, sans fenêtre (préversion Vite, tests)
    serve_only = '--serve' in sys.argv
    port = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else PREFERRED_PORT
    port = run_local_server(web_dir, port)
    app_url = f"http://127.0.0.1:{port}"
    print(f"[mTRANSLATOR] Serveur local actif sur : {app_url}", flush=True)
    if serve_only:
        threading.Event().wait()
    launch_native_window(app_url)


if __name__ == '__main__':
    main()
