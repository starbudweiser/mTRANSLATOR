/**
 * Import/export des traductions au format XML de xTranslator (SSTXMLRessources).
 *
 * <String List="0" sID="0012E4" Partial="1"> : sID = FormID sans l'octet d'ordre de chargement,
 * Partial présent = traduction incomplète. <REC>WEAP:FULL</REC> donne le type et le champ.
 */
import type { ModRecord } from '../types';

const XT_LANGS: Record<string, string> = {
  en: 'english', fr: 'french', de: 'german', es: 'spanish', it: 'italian', pl: 'polish',
  ru: 'russian', ja: 'japanese', zh: 'chinese', cs: 'czech', pt: 'portuguese',
};

export interface XtXmlEntry {
  sId: string;
  edid: string;
  rec: string;
  field: string;
  source: string;
  dest: string;
  partial: boolean;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unesc(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/** FormID sans l'octet de chargement : « 0012E4 ». */
function shortId(formId: string): string {
  const hex = formId.replace(/^0x/i, '').toUpperCase();
  return /^[0-9A-F]{1,8}$/.test(hex) ? hex.padStart(8, '0').slice(2) : hex;
}

/** Clé d'appariement ; l'occurrence distingue les chaînes répétées d'un même champ. */
function matchKey(rec: string, field: string, sId: string, n: number): string {
  return `${rec}:${field}:${sId}#${n}`;
}

export function exportToXtXml(records: ModRecord[], addon: string, sourceLocale: string, targetLocale: string): string {
  const rows = records.filter((r) => r.target.trim() && r.target !== r.source);
  const body = rows
    .map((r) => {
      const partial = r.status === 'partial' || !r.validated ? ' Partial="1"' : '';
      const rec = `${r.recordType}:${r.field || 'FULL'}`;
      return (
        `<String List="0" sID="${esc(shortId(r.formId))}"${partial}>\n` +
        `<EDID>${esc(r.edid || '')}</EDID>\n<REC>${esc(rec)}</REC>\n` +
        `<Source>${esc(r.source)}</Source>\n<Dest>${esc(r.target)}</Dest>\n</String>`
      );
    })
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<SSTXMLRessources>\n<Params>\n' +
    `<Addon>${esc(addon.replace(/\.[^.]+$/, ''))}</Addon>\n` +
    `<Source>${XT_LANGS[sourceLocale] ?? sourceLocale}</Source>\n<Dest>${XT_LANGS[targetLocale] ?? targetLocale}</Dest>\n` +
    `<Version>2</Version>\n</Params>\n<Content>\n${body}\n</Content>\n</SSTXMLRessources>\n`
  );
}

export function parseXtXml(content: string): XtXmlEntry[] {
  const out: XtXmlEntry[] = [];
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
    return m ? unesc(m[1]) : '';
  };
  for (const m of content.matchAll(/<String\b([^>]*)>([\s\S]*?)<\/String>/g)) {
    const attrs = m[1];
    const block = m[2];
    const [rec, field = ''] = tag(block, 'REC').split(':');
    out.push({
      sId: (attrs.match(/\bsID="([^"]*)"/)?.[1] ?? '').toUpperCase(),
      edid: tag(block, 'EDID'),
      rec,
      field,
      source: tag(block, 'Source'),
      dest: tag(block, 'Dest'),
      partial: /\bPartial="[^"0]/.test(attrs),
    });
  }
  return out;
}

/**
 * Associe les entrées XML aux lignes : d'abord par type, champ et FormID (puis rang d'occurrence),
 * sinon par texte original identique. Renvoie, par id de ligne, la traduction à appliquer.
 */
export function matchXtXml(records: ModRecord[], entries: XtXmlEntry[]): Map<string, XtXmlEntry> {
  const byKey = new Map<string, ModRecord>();
  const seen = new Map<string, number>();
  for (const r of records) {
    const base = `${r.recordType}:${r.field || 'FULL'}:${shortId(r.formId)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    byKey.set(matchKey(r.recordType, r.field || 'FULL', shortId(r.formId), n), r);
  }
  const bySource = new Map<string, ModRecord[]>();
  for (const r of records) {
    const list = bySource.get(r.source);
    if (list) list.push(r);
    else bySource.set(r.source, [r]);
  }

  const result = new Map<string, XtXmlEntry>();
  const seenXml = new Map<string, number>();
  for (const e of entries) {
    if (!e.dest) continue;
    const base = `${e.rec}:${e.field}:${e.sId}`;
    const n = seenXml.get(base) ?? 0;
    seenXml.set(base, n + 1);
    const hit = byKey.get(matchKey(e.rec, e.field, e.sId, n));
    if (hit && hit.source === e.source) {
      result.set(hit.id, e);
      continue;
    }
    // Repli : même texte original (FormID différent d'un ordre de chargement à l'autre, ligne déplacée)
    for (const r of bySource.get(e.source) ?? []) {
      if (!result.has(r.id)) result.set(r.id, e);
    }
  }
  return result;
}
