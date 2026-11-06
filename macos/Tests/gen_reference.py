#!/usr/bin/env python3
"""Génère Tests/MTCoreTests/Fixtures/engines_ref.json : sorties de référence de mt_engines.py (version Python),
pour comparer le port Swift (MTCore/Engines.swift) sans réseau.

Usage : gen_reference.py [révision git de l'ancienne enveloppe Python, par défaut dd49c04]
Le réseau est simulé par une fausse urlopen (mêmes règles que le faux Transport des tests Swift) ; les requêtes
construites (URL + corps) sont enregistrées avec les résultats.
"""
import io, json, re, subprocess, sys, types, urllib.error, urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
REV = sys.argv[1] if len(sys.argv) > 1 else 'dd49c04'
src = subprocess.run(['git', '-C', str(ROOT), 'show', f'{REV}:python_app/mt_engines.py'], capture_output=True, text=True, check=True).stdout
mt = types.ModuleType('mt_engines_ref')
exec(compile(src, 'mt_engines_ref', 'exec'), mt.__dict__)
asrc = subprocess.run(['git', '-C', str(ROOT), 'show', f'{REV}:python_app/mtranslator_app.py'], capture_output=True, text=True, check=True).stdout
m = re.search(r"def resolve_lang_code.*?    return 'fr'\n", asrc, re.S)
ns = {}
exec(m.group(0), ns)
resolve_lang_code = ns['resolve_lang_code']

REQUESTS = []


class Resp:
    def __init__(self, data): self.data = data
    def read(self): return self.data
    def __enter__(self): return self
    def __exit__(self, *a): return False


def fake_urlopen(req, timeout=None):
    url = req.full_url
    body = req.data.decode('utf-8') if req.data else None
    REQUESTS.append([url, body])
    if 'translate.googleapis.com' in url:
        tl = re.search(r'tl=(\w+)', url).group(1)
        out = []
        for k, q in urllib.parse.parse_qsl(body, keep_blank_values=True):
            if q.startswith('FR:'):
                out.append(['~' + q + '~', 'fr'])
            elif 'BREAK' in q:
                out.append(['~' + re.sub(r'⟦\d+⟧', '', q) + '~', 'en'])
            else:
                out.append([('~' + q + '~').replace('Aonghus', 'Angus').replace('Maliq', 'Malik'), 'en'])
        return Resp(json.dumps(out).encode())
    if ':generateContent' in url:
        key = re.search(r'key=([^&]*)', url).group(1)
        if key == 'badkey':
            raise urllib.error.HTTPError(url, 429, 'Too Many Requests', {}, io.BytesIO(json.dumps({'error': {'message': 'quota'}}).encode()))
        prompt = json.loads(body)['contents'][0]['parts'][0]['text']
        items = json.loads(prompt.split('Textes :\n', 1)[1])
        res = [re.sub(mt.TAG, '', t) if 'DROP' in t else 'G:' + t for t in items]
        return Resp(json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps(res, ensure_ascii=False)}]}}]}).encode())
    if '/models?' in url:
        return Resp(json.dumps({'models': [
            {'name': 'models/gemini-2.5-flash', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-2.5-pro', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-embedding-001', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/text-bison', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-old', 'supportedGenerationMethods': ['embedContent']},
            {'name': 'models/gemini-1.5-flash', 'supportedGenerationMethods': ['generateContent']},
        ]}).encode())
    raise urllib.error.URLError('inconnu')


mt.urllib.request.urlopen = fake_urlopen

TEXTS = [
    "Hello world", "<Alias=Player> hits you for %d damage.", "Line one\nLine two", "[pagebreak]Next page",
    "AonghusHousePlanterNPC", "12345", "", "  padded text  ", "Go to Whiterun and meet Aonghus.",
    "See <font color='#fff'>Dawnstar</font> now", "$Variable stays", "<b>BREAK</b> now", "FR: déjà traduit",
    "Hello world", "Ça va très bien, ñandú", "{curly} text here", "x\r\ny", "Maliq arrives at the Hall of the Dead.",
    "Visit Falkreath Hold, Whiterun and Solitude.", "\\n literal newline\\nsecond", "100% sure, %s ok", "日本語のテキスト",
    "Tab\tseparated words", "nbsp text here", "Whiterun's gate", "In the Reach and the Rift",
]
GLOSS = [
    {'rec': 'CELL', 'field': 'FULL', 'source': 'Whiterun', 'dest': 'Blancherive'},
    {'rec': 'CELL', 'field': 'FULL', 'source': 'Whiterun', 'dest': 'Blancherive'},
    {'rec': 'LCTN', 'field': 'FULL', 'source': 'Falkreath Hold', 'dest': 'Fief de Faillaise'},
    {'rec': 'LCTN', 'field': 'FULL', 'source': 'Hall of the Dead', 'dest': 'Salle des Morts'},
    {'rec': 'WRLD', 'field': 'FULL', 'source': 'Solitude', 'dest': 'Solitude'},
    {'rec': 'REGN', 'field': 'FULL', 'source': 'The Reach', 'dest': 'Le Récif'},
    {'rec': 'REGN', 'field': 'FULL', 'source': 'The Rift', 'dest': 'La Faille'},
    {'rec': 'REGN', 'field': 'FULL', 'source': 'The Rift', 'dest': 'Le Gouffre'},
    {'rec': 'NPC_', 'field': 'FULL', 'source': 'Dawnstar', 'dest': 'Aubétoile'},
    {'rec': 'FACT', 'field': 'FULL', 'source': 'Dawnstar', 'dest': 'Aubétoile'},
    {'rec': 'FACT', 'field': 'EDID', 'source': 'Riften', 'dest': 'Vendeaume'},
    {'rec': 'FACT', 'field': 'FULL', 'source': 'lowercase', 'dest': 'x'},
]

cases = {}
cases['texts'] = TEXTS
cases['glossary_entries'] = GLOSS
cases['resolve_lang'] = {x: resolve_lang_code(x) for x in ['Français', 'Deutsch', 'es', 'Espagnol', 'Italiano', 'polish', 'Русский', 'English', '', 'zz', 'Anglais', ' ES ', 'german', 'portuguese', 'DE']}
cases['split_runs'] = [[[ok, s] for ok, s in mt.split_runs(t)] for t in TEXTS]
cases['tags_of'] = [mt.tags_of(t) for t in TEXTS]
g = mt.build_glossary(GLOSS)
cases['glossary_terms'] = g[1] if g else None
cases['glossary_compound_alt'] = g[0].pattern if g and g[0] else None
cases['glossary_single_alt'] = g[2].pattern if g and g[2] else None
cases['masked'] = {}
for label, gl in (('none', None), ('gloss', g)):
    cases['masked'][label] = [[mt._mask(l.strip(), gl)[0], mt._mask(l.strip(), gl)[1]] for t in TEXTS for is_line, l in mt._lines(t) if is_line]
cases['google'] = {}
for label, gl, tl in (('fr_none', None, 'fr'), ('fr_gloss', g, 'fr'), ('es_none', None, 'es')):
    REQUESTS.clear()
    out = mt.google_batch(TEXTS, tl=tl, glossary=gl)
    cases['google'][label] = {'out': out, 'requests': sorted(REQUESTS)}
cases['restore'] = [[a, b, mt._restore_names(a, b)] for a, b in [
    ('Meet Aonghus and Maliq', 'Rencontrez Angus et Malik'), ('Aonghus', 'Angus'), ('Hello Thalmor there', 'Bonjour Talmor ici'),
    ('Sven and Faendal', 'Sven et Faendale'), ('Ysolda', 'Isolda'), ('Nothing here', 'Rien ici')]]
cases['rename'] = [[a, b, mt._rename(a, b, g)] for a, b in [
    ('Go to Whiterun now', 'Allez à Whiterun maintenant'), ('Whiterun and Solitude', 'Whiterun et Solitude'), ('Nothing', 'Whiterun')]]
cases['seq_ratio'] = [[a, b, SM] for a, b in [('angus', 'aonghus'), ('malik', 'maliq'), ('', ''), ('abc', ''), ('faendale', 'faendal'), ('talmor', 'thalmor')]
                      for SM in [__import__('difflib').SequenceMatcher(None, a, b).ratio()]]
REQUESTS.clear()
cases['gemini'] = {}
gt = ["Hello world", "<Alias=Player> hits you for %d", "DROP <b>this</b> one", "Ça va"]
res, warn = mt.gemini_batch(gt, 'k3y', 'gemini-2.5-flash', game='Skyrim')
cases['gemini']['ok'] = {'texts': gt, 'out': res, 'warning': warn, 'requests': sorted(REQUESTS)}
REQUESTS.clear()
res, warn = mt.gemini_batch(gt, 'badkey', 'gemini-2.5-flash', game='Fallout 4')
cases['gemini']['bad'] = {'texts': gt, 'out': res, 'warning': warn, 'requests': sorted(REQUESTS)}
REQUESTS.clear()
big = [("Texte numéro %d " % i) * 30 for i in range(100)]
res, warn = mt.gemini_batch(big, 'k3y', 'gemini-2.5-flash')
cases['gemini']['big'] = {'texts': big, 'out': res, 'warning': warn, 'requests': sorted(REQUESTS)}
REQUESTS.clear()
cases['gemini']['models'] = {'out': mt.gemini_models('k/3 y'), 'requests': REQUESTS[:]}

(HERE / 'MTCoreTests' / 'Fixtures' / 'engines_ref.json').write_text(json.dumps(cases, ensure_ascii=False, indent=1), encoding='utf-8')
print('ok')
