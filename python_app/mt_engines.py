"""Moteurs de traduction automatique de mTRANSLATOR.

- google : Google Traduction, gratuit et sans clé (point d'accès public « gtx »), plusieurs textes par requête.
- gemini : Gemini (clé API Google AI Studio, offre gratuite disponible), consignes adaptées aux jeux Bethesda.

Les balises Bethesda (<Alias=…>, <font …>, %d, [pagebreak], sauts de ligne…) ne sont jamais envoyées à
Google : seul le texte entre elles est traduit, puis le texte est recomposé. Gemini reçoit le texte entier
avec consigne de garder les balises ; une réponse aux balises modifiées est rejetée.
"""

import json
import re
from difflib import SequenceMatcher
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# Éléments à conserver tels quels : balises, codes de format, sauts de ligne, alias, variables d'interface
TAG = re.compile(r'<[^<>]*>|\[[^\[\]]*\]|%[-+0-9.]*[a-zA-Z]|\$[A-Za-z_][\w]*|\{[^{}]*\}|\\[nrt]|\r\n|[\r\n\t]')
LETTER = re.compile(r'[^\W\d_]')
UA = {'User-Agent': 'Mozilla/5.0'}
GOOGLE_URL = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl={tl}'
GOOGLE_BUDGET = 4500  # caractères par requête groupée
GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'


def tags_of(text):
    return sorted(TAG.findall(text))


def split_runs(text):
    """Découpe un texte en morceaux ; renvoie [(est_traduisible, morceau)]. Les espaces de bord restent hors du texte envoyé."""
    parts, pos = [], 0
    for m in TAG.finditer(text):
        if m.start() > pos:
            parts.append(text[pos:m.start()])
        parts.append((m.group(),))
        pos = m.end()
    if pos < len(text):
        parts.append(text[pos:])
    out = []
    for p in parts:
        if isinstance(p, tuple):
            out.append((False, p[0]))
            continue
        core = p.strip()
        if not core or not LETTER.search(core):
            out.append((False, p))
            continue
        lead, trail = p[:len(p) - len(p.lstrip())], p[len(p.rstrip()):]
        if lead:
            out.append((False, lead))
        out.append((True, core))
        if trail:
            out.append((False, trail))
    return out


def _google_chunk(runs, tl):
    """Traductions d'un groupe de textes ; un texte déjà dans la langue cible (détection de Google)
    revient inchangé, sinon Google « retraduit » un mod déjà francisé et l'abîme."""
    body = urllib.parse.urlencode([('q', r) for r in runs]).encode()
    req = urllib.request.Request(GOOGLE_URL.format(tl=tl), data=body, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    out = []
    for r, d in zip(runs, data):
        text, lang = (d[0], d[1]) if isinstance(d, list) else (d, '')
        out.append(r if lang == tl else text)
    return out if len(out) == len(runs) else []


NEWLINE = re.compile(r'\r\n|[\r\n]|\\n|\[pagebreak\]', re.I)
PH = re.compile(r'⟦(\d+)⟧')


def _mask(line, glossary=None):
    """Remplace les codes en ligne par ⟦n⟧ (Google les garde) pour traduire la phrase entière ;
    les noms du glossaire deviennent aussi des marqueurs, rendus par leur nom français officiel."""
    tags = []

    def sub(m):
        tags.append(m.group())
        return f'⟦{len(tags) - 1}⟧'

    def gsub(m):
        tags.append(glossary[1][m.group()])
        return f'⟦{len(tags) - 1}⟧'
    if IDENT.match(line):
        tags.append(line)
        return '⟦0⟧', tags
    out = TAG.sub(sub, line)
    if glossary and glossary[0]:
        out = glossary[0].sub(gsub, out)
    return out, tags


def _restore_names(src, dest):
    """Noms propres du mod que Google « corrige » (Aonghus → Angus, Maliq → Malik) : mot à majuscule
    absent du dictionnaire anglais, disparu de la traduction, remis à la place du mot le plus proche."""
    words = _english_words()
    if not words:
        return dest
    for name in set(CAPWORD.findall(src)):
        if name.lower() in words or re.search(rf'(?<!\w){re.escape(name)}(?!\w)', dest):
            continue
        cands = [w for w in set(CAPWORD.findall(dest)) if w not in src]
        best = max(cands, key=lambda w: SequenceMatcher(None, w.lower(), name.lower()).ratio(), default=None)
        if best and SequenceMatcher(None, best.lower(), name.lower()).ratio() >= 0.7:
            dest = re.sub(rf'(?<!\w){re.escape(best)}(?!\w)', name, dest)
    return dest


# Mot à majuscule (candidat nom propre) ; identifiant collé (« AonghusHousePlanterNPC ») gardé tel quel
CAPWORD = re.compile(r"(?<![\w⟦-])[A-Z][a-z]{2,}(?![\w-])")
IDENT = re.compile(r'^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$')
_WORDS = None


def _english_words():
    global _WORDS
    if _WORDS is None:
        try:
            with open('/usr/share/dict/words', encoding='utf-8', errors='ignore') as f:
                _WORDS = {w.strip().lower() for w in f}
        except OSError:
            _WORDS = set()
    return _WORDS


def _rename(src, dest, glossary):
    """Noms d'un seul mot laissés en anglais par Google (« à Whiterun ») : remplacés par le nom officiel."""
    if not glossary or not glossary[2]:
        return dest
    found = set(glossary[2].findall(src))
    return glossary[2].sub(lambda m: glossary[1][m.group()] if m.group() in found else m.group(), dest) if found else dest


# Glossaire de noms officiels (lieux, factions…) issu des SST du jeu de base et des DLC
GLOSSARY_RECS = {'LCTN', 'WRLD', 'CELL', 'REGN', 'FACT'}
NAME = re.compile(r"^[A-Z][\w'-]+(?: (?:of |the |de )?[A-Z][\w'-]+){0,3}$")


def build_glossary(entries):
    """entries : éléments SST (source, dest, rec, field). Renvoie (motif des noms composés, dict,
    motif des noms d'un mot) ou None. Les noms composés sont masqués avant envoi (Google les traduirait
    à moitié) ; ceux d'un mot passent tels quels pour garder la bonne préposition, puis sont remplacés."""
    from collections import Counter, defaultdict
    seen = defaultdict(Counter)
    for e in entries:
        if e.get('rec') in GLOSSARY_RECS and e.get('field') == 'FULL' and NAME.match(e['source']) and e['source'] != e['dest']:
            seen[e['source']][e['dest']] += 1
    terms = {}
    for src, c in seen.items():
        dest, n = c.most_common(1)[0]
        if n / sum(c.values()) >= 0.6:
            terms[src] = dest
    if not terms:
        return None
    def pattern(words):
        if not words:
            return None
        alt = '|'.join(re.escape(t) for t in sorted(words, key=len, reverse=True))
        return re.compile(rf"(?<![\w'-])(?:{alt})(?![\w-]|'(?!s\b))")
    return pattern([t for t in terms if ' ' in t]), terms, pattern([t for t in terms if ' ' not in t])


def _unmask(text, tags):
    found = [int(n) for n in PH.findall(text)]
    if sorted(found) != list(range(len(tags))):
        return None
    return PH.sub(lambda m: tags[int(m.group(1))], text)


def _google_many(segments, tl):
    """Traduit des segments uniques par requêtes groupées en parallèle ; dict segment -> traduction."""
    unique = list(dict.fromkeys(segments))
    chunks, cur, size = [], [], 0
    for r in unique:
        if cur and size + len(r) > GOOGLE_BUDGET:
            chunks.append(cur)
            cur, size = [], 0
        cur.append(r)
        size += len(r)
    if cur:
        chunks.append(cur)
    done = {}

    def run(chunk):
        try:
            res = _google_chunk(chunk, tl)
            if len(res) == len(chunk):
                done.update(zip(chunk, res))
        except (urllib.error.URLError, OSError, ValueError, IndexError, TypeError):
            pass

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(run, chunks))
    return done


def _lines(text):
    """[(est_une_ligne, morceau)] : les séparateurs de ligne restent intacts."""
    out, pos = [], 0
    for m in NEWLINE.finditer(text):
        out.append((True, text[pos:m.start()]))
        out.append((False, m.group()))
        pos = m.end()
    out.append((True, text[pos:]))
    return out


def google_batch(texts, tl='fr', glossary=None):
    """Traduit une liste de textes ; None pour un texte non traduit (erreur réseau)."""
    plan = []  # par texte : liste de (morceau littéral) ou (ligne masquée, balises, espaces avant/après)
    masked = []
    for t in texts:
        parts = []
        for is_line, chunk in _lines(t or ''):
            if not is_line:
                parts.append(chunk)
                continue
            m, tags = _mask(chunk.strip(), glossary)
            if not LETTER.search(PH.sub('', m)):
                parts.append(chunk)
                continue
            lead, trail = chunk[:len(chunk) - len(chunk.lstrip())], chunk[len(chunk.rstrip()):]
            parts.append((m, tags, lead, trail))
            masked.append(m)
        plan.append(parts)
    done = _google_many(masked, tl)

    # Secours : ligne dont les marqueurs ont bougé, traduite morceau par morceau entre les balises
    retry = {}
    for parts in plan:
        for p in parts:
            if isinstance(p, tuple) and p[0] in done and _unmask(done[p[0]], p[1]) is None:
                retry[p[0]] = [r for ok, r in split_runs(_unmask(p[0], p[1]) or '') if ok]
    runs = _google_many([r for rs in retry.values() for r in rs], tl) if retry else {}

    out = []
    for t, parts in zip(texts, plan):
        res = []
        for p in parts:
            if not isinstance(p, tuple):
                res.append(p)
                continue
            m, tags, lead, trail = p
            line = _unmask(done[m], tags) if m in done else None
            if line is None and m in retry and all(r in runs for r in retry[m]):
                line = ''.join(runs[r] if ok else r for ok, r in split_runs(_unmask(m, tags)))
            if line is None:
                res = None
                break
            src = _unmask(m, tags) or ''
            res.append(lead + _restore_names(src, _rename(src, line, glossary)) + trail)
        out.append(t if res is not None and not any(isinstance(p, tuple) for p in parts) else (''.join(res) if res is not None else None))
    return out


GEMINI_PROMPT = (
    "Tu traduis des textes du jeu {game} de l'anglais vers le {lang}, pour un mod. "
    "Respecte la terminologie officielle française de la série (Bordeciel, Blancherive, Solitude, "
    "Faillaise, Vendeaume, Markarth, Aubétoile, Rougegarde, Brétonne, Elfe des bois…). "
    "Conserve STRICTEMENT à l'identique toutes les balises et codes : <…>, [pagebreak], %d, %s, $Variables, "
    "{{…}}, sauts de ligne. Ne traduis pas l'intérieur des balises. "
    "Réponds uniquement par un tableau JSON de chaînes, une traduction par texte, dans le même ordre.\n\n"
    "Textes :\n{items}"
)


def gemini_models(key):
    """Modèles Gemini utilisables pour générer du texte avec cette clé."""
    req = urllib.request.Request(f'{GEMINI_API}/models?pageSize=200&key={urllib.parse.quote(key)}', headers=UA)
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    names = [m['name'].split('/', 1)[-1] for m in data.get('models', [])
             if 'generateContent' in m.get('supportedGenerationMethods', [])]
    return sorted((n for n in names if n.startswith('gemini') and 'embedding' not in n and 'image' not in n
                   and 'tts' not in n and 'audio' not in n), reverse=True)


def _gemini_chunk(texts, key, model, game, lang):
    prompt = GEMINI_PROMPT.format(game=game, lang=lang, items=json.dumps(texts, ensure_ascii=False))
    body = json.dumps({
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'temperature': 0.2, 'responseMimeType': 'application/json'},
    }).encode()
    req = urllib.request.Request(f'{GEMINI_API}/models/{urllib.parse.quote(model)}:generateContent?key={urllib.parse.quote(key)}',
                                 data=body, headers={**UA, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode('utf-8')).get('error', {}).get('message', '')
        except ValueError:
            msg = ''
        raise RuntimeError(f'Gemini {e.code} : {msg or e.reason}') from e
    text = data['candidates'][0]['content']['parts'][0]['text']
    res = json.loads(text)
    if not isinstance(res, list) or len(res) != len(texts):
        raise RuntimeError('réponse Gemini incomplète')
    return [str(r) for r in res]


def gemini_batch(texts, key, model, game='Skyrim', lang='français', chunk_chars=6000):
    """Traduit avec Gemini ; un texte dont les balises ont changé ressort à None (repli possible)."""
    chunks, cur, size = [], [], 0
    for i, t in enumerate(texts):
        if cur and (size + len(t) > chunk_chars or len(cur) >= 40):
            chunks.append(cur)
            cur, size = [], 0
        cur.append(i)
        size += len(t)
    if cur:
        chunks.append(cur)
    out = [None] * len(texts)
    errors = []

    def run(idx):
        try:
            res = _gemini_chunk([texts[i] for i in idx], key, model, game, lang)
            for i, r in zip(idx, res):
                if r and tags_of(r) == tags_of(texts[i]):
                    out[i] = r
        except (RuntimeError, urllib.error.URLError, OSError, ValueError, KeyError, IndexError) as e:
            errors.append(str(e))

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(run, chunks))
    return out, (errors[0] if errors else None)
