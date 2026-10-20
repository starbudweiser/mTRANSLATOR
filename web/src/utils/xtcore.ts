// Client du cœur Rust xtcore (servi par l'app macOS sur /api/xtcore).
// Disponible seulement dans l'app compilée ou avec le serveur Python local.

export interface XtString {
  id: number;
  form_id: number;
  rec: string;
  field: string;
  edid: string;
  index: number;
  index_max: number;
  list: number;
  str_id: number;
  text: string;
  /** Chaîne d'une propriété de script Papyrus (champ VMAD). */
  vmad?: { off: number; script: string; prop: string };
}

export interface XtTxtString {
  id: number;
  line: number;
  index: number;
  index_max: number;
  key: string;
  text: string;
}

export interface XtTxt {
  kind: string;
  encoding: string;
  output_name: string;
  count: number;
  strings: XtTxtString[];
}

export interface XtExtract {
  game: 'Skyrim' | 'SkyrimSE' | 'Fallout4' | 'Starfield';
  localized: boolean;
  masters: string[];
  count: number;
  strings: XtString[];
}

export interface XtTranslate {
  strings: number;
  exact: number;
  heuristic: number;
  search_ms: number;
  written: string | null;
  results: Array<{ id: number; kind: 'exact' | 'heuristic'; dest: string; ld?: number }>;
}

export interface XtSearchHit {
  ld: number;
  source: string;
  dest: string;
  rec: string;
  field: string;
}

export interface XtSearch {
  exact: string | null;
  candidates: number;
  search_us: number;
  results: XtSearchHit[];
}

export async function xtcoreAvailable(): Promise<boolean> {
  try {
    const r = await fetch('/api/health');
    return Boolean((await r.json()).xtcore);
  } catch {
    return false;
  }
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-mTRANSLATOR': '1' },
    body: JSON.stringify(body),
  });

export async function xtcore<T>(args: string[], stdin?: string): Promise<T> {
  const r = await post('/api/xtcore', { args, stdin });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error ?? `xtcore : erreur ${r.status}`);
  return data as T;
}

/** Sélecteur de fichier natif (côté Python) : chemin absolu, ou null si annulé. */
export async function pickFile(o: {
  mode?: 'open' | 'save' | 'folder';
  title?: string;
  defaultName?: string;
  directory?: string;
  fileTypes?: string[];
}): Promise<string | null> {
  const r = await post('/api/pick-file', o);
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error ?? `sélecteur : erreur ${r.status}`);
  return data.path ?? null;
}

/** Sélecteur natif à sélection multiple : chemins absolus (liste vide si annulé). */
export async function pickFiles(o: { title?: string; directory?: string; fileTypes?: string[] }): Promise<string[]> {
  const r = await post('/api/pick-file', { ...o, mode: 'open', multiple: true });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error ?? `sélecteur : erreur ${r.status}`);
  return Array.isArray(data.path) ? data.path : data.path ? [data.path] : [];
}

/** Dictionnaire par défaut : dossier de SST de xTranslator. */
export const DEFAULT_XT_DICT = '/Volumes/SKYRIM/TOOLS/WINDOWS/_xTranslator/UserDictionaries/SkyrimSE';
const DICT_KEY = 'mtranslator_xtcore_dict';
export const getXtDict = () => {
  try {
    return localStorage.getItem(DICT_KEY) || DEFAULT_XT_DICT;
  } catch {
    return DEFAULT_XT_DICT;
  }
};
export const setXtDict = (dir: string) => {
  try {
    localStorage.setItem(DICT_KEY, dir);
  } catch {
    // stockage indisponible : réglage non conservé
  }
};

/** Score en % affiché pour une distance heuristique (0 = identique, 1 = limite par défaut). */
export const ldScore = (ld: number) => Math.max(0, Math.min(100, Math.round(100 - ld * 40)));

const opt = (k: string, v?: string) => (v ? [`--${k}`, v] : []);

export const xt = {
  extract: (plugin: string, lang = 'french', game?: string) =>
    xtcore<XtExtract>(['extract', plugin, ...opt('lang', lang), ...opt('game', game)]),
  translate: (plugin: string, dict: string, o: { sst?: string; out?: string; maxLd?: number; lang?: string; vmad?: boolean } = {}) =>
    xtcore<XtTranslate>([
      'translate', plugin, '--dict', dict, '--full', ...(o.vmad ? ['--vmad'] : []),
      ...opt('sst', o.sst), ...opt('out', o.out), ...opt('max-ld', o.maxLd?.toString()), ...opt('lang', o.lang),
    ]),
  apply: (plugin: string, sst: string, out: string) => xtcore<{ strict: number; by_text: number }>(['apply', plugin, '--sst', sst, '--out', out]),
  write: (plugin: string, out: string, rows: Array<{ id: number; dest: string }>, sst?: string) =>
    xtcore<{ strings: number; written_count: number; written: string; backup: string | null }>(
      ['write', plugin, '--out', out, ...opt('sst', sst)],
      JSON.stringify(rows),
    ),
  sstExport: (plugin: string, out: string, rows: Array<{ id: number; dest: string; source?: string; incomplete?: boolean }>) =>
    xtcore<{ entries: number; written: string; backup: string | null }>(['sst-export', plugin, '--out', out], JSON.stringify(rows)),
  txt: (file: string, lang = 'french') => xtcore<XtTxt>(['txt', file, ...opt('lang', lang)]),
  txtTranslate: (file: string, dict: string) =>
    xtcore<{ strings: number; results: XtTranslate['results'] }>(['txt-translate', file, '--dict', dict]),
  txtWrite: (file: string, out: string, rows: Array<{ id: number; dest: string }>) =>
    xtcore<{ strings: number; written_count: number; written: string; backup: string | null }>(
      ['txt-write', file, '--out', out],
      JSON.stringify(rows),
    ),
  search: (dict: string, text: string, top = 10, rec?: string, field?: string) =>
    xtcore<XtSearch>(['search', '--dict', dict, '--text', text, '--top', String(top), ...opt('rec', rec), ...opt('field', field)]),
};
