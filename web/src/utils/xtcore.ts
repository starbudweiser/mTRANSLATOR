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

export async function xtcoreAvailable(): Promise<boolean> {
  try {
    const r = await fetch('/api/health');
    return Boolean((await r.json()).xtcore);
  } catch {
    return false;
  }
}

export async function xtcore<T>(args: string[]): Promise<T> {
  const r = await fetch('/api/xtcore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-mTRANSLATOR': '1' },
    body: JSON.stringify({ args }),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error ?? `xtcore : erreur ${r.status}`);
  return data as T;
}

const opt = (k: string, v?: string) => (v ? [`--${k}`, v] : []);

export const xt = {
  extract: (plugin: string, lang = 'french', game?: string) =>
    xtcore<XtExtract>(['extract', plugin, ...opt('lang', lang), ...opt('game', game)]),
  translate: (plugin: string, dict: string, o: { sst?: string; out?: string; maxLd?: number; lang?: string } = {}) =>
    xtcore<XtTranslate>([
      'translate', plugin, '--dict', dict, '--full',
      ...opt('sst', o.sst), ...opt('out', o.out), ...opt('max-ld', o.maxLd?.toString()), ...opt('lang', o.lang),
    ]),
  apply: (plugin: string, sst: string, out: string) => xtcore<{ strict: number; by_text: number }>(['apply', plugin, '--sst', sst, '--out', out]),
  search: (dict: string, text: string, top = 10) =>
    xtcore<{ exact: string | null; results: XtSearchHit[] }>(['search', '--dict', dict, '--text', text, '--top', String(top)]),
};
