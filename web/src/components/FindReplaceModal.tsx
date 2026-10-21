/**
 * Rechercher & remplacer dans les traductions (VF) du fichier ouvert.
 * Le texte d'origine (VO) n'est jamais modifié : il sert de clé aux exports SST et à l'écriture du plugin.
 */

import React, { useMemo, useState } from 'react';
import { X, SlidersHorizontal, Check, AlertCircle, Undo2 } from 'lucide-react';
import { ModRecord } from '../types';
import { L } from '../i18n/L';

export interface ReplaceOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  /** Ne pas toucher les lignes encore non traduites (cible = VO). */
  skipUntranslated: boolean;
}

/** Motif de recherche, ou message d'erreur si l'expression régulière est invalide. */
export function buildPattern(find: string, o: ReplaceOptions): RegExp | string {
  let body = o.useRegex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) body = `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(body, `gu${o.caseSensitive ? '' : 'i'}`);
  } catch (err: any) {
    return L("Expression régulière invalide : {message}", { message: err.message });
  }
}

export const isReplaceable = (r: ModRecord, o: ReplaceOptions) =>
  !r.locked && Boolean(r.target) && !(o.skipUntranslated && r.status === 'untranslated');

interface FindReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: ModRecord[];
  onBatchReplace: (pattern: RegExp, replaceText: string, options: ReplaceOptions) => { lines: number; occurrences: number };
  canUndo: boolean;
  onUndo: () => void;
}

const PREVIEW_MAX = 50;

export const FindReplaceModal: React.FC<FindReplaceModalProps> = ({
  isOpen,
  onClose,
  records,
  onBatchReplace,
  canUndo,
  onUndo,
}) => {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [opts, setOpts] = useState<ReplaceOptions>({
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    skipUntranslated: true,
  });
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const pattern = useMemo(() => (findText ? buildPattern(findText, opts) : null), [findText, opts]);

  // Aperçu : lignes concernées et texte après remplacement
  const preview = useMemo(() => {
    if (!(pattern instanceof RegExp)) return { lines: [] as Array<{ rec: ModRecord; after: string }>, total: 0, occ: 0 };
    const lines: Array<{ rec: ModRecord; after: string }> = [];
    let total = 0;
    let occ = 0;
    for (const rec of records) {
      if (!isReplaceable(rec, opts)) continue;
      const n = rec.target.match(pattern)?.length ?? 0;
      if (!n) continue;
      total++;
      occ += n;
      if (lines.length < PREVIEW_MAX) lines.push({ rec, after: rec.target.replace(pattern, replaceText) });
    }
    return { lines, total, occ };
  }, [pattern, records, replaceText, opts]);

  if (!isOpen) return null;

  const set = (k: keyof ReplaceOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setOpts((o) => ({ ...o, [k]: e.target.checked }));
    setResultMessage(null);
  };

  const handleExecuteReplace = () => {
    if (!(pattern instanceof RegExp) || !preview.total) return;
    const r = onBatchReplace(pattern, replaceText, opts);
    setResultMessage(L("{occurrences} occurrence(s) remplacée(s) sur {lines} ligne(s).", { occurrences: r.occurrences, lines: r.lines }));
  };

  const field =
    'w-full bg-[#181818] text-[#ffffff] px-3 py-1.5 rounded border border-[#333333] focus:outline-none focus:border-[#22c55e]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-4 text-xs select-none">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-md shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-[#dddddd]">
        {/* En-tête */}
        <div className="h-10 shrink-0 bg-[#262626] border-b border-[#333333] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <SlidersHorizontal className="w-4 h-4 text-[#4ade80]" />
            <span className="font-semibold text-white">{L("Rechercher & remplacer dans les traductions")}</span>
          </div>
          <button type="button" onClick={onClose} className="text-[#aaaaaa] hover:text-white p-1 rounded hover:bg-[#303030]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3.5 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-medium block">{L("Rechercher :")}</label>
              <input
                type="text"
                autoFocus
                value={findText}
                onChange={(e) => {
                  setFindText(e.target.value);
                  setResultMessage(null);
                }}
                placeholder={L("Texte ou motif Regex...")}
                className={field}
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium block">{L("Remplacer par :")}</label>
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder={opts.useRegex ? L("Texte ($1, $2… pour les groupes)") : L("Texte de remplacement...")}
                className={field}
              />
            </div>
          </div>

          <div className="p-3 bg-[#181818] border border-[#2e2e2e] rounded flex flex-wrap gap-x-4 gap-y-2">
            {(
              [
                ['caseSensitive', L("Respecter la casse")],
                ['wholeWord', L("Mot entier")],
                ['useRegex', L("Expression régulière")],
                ['skipUntranslated', L("Ignorer les lignes non traduites")],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center space-x-2 cursor-pointer">
                <input type="checkbox" checked={opts[k]} onChange={set(k)} className="accent-[#22c55e]" />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {typeof pattern === 'string' && (
            <div className="p-2.5 border border-[#ef4444] rounded text-[#fecaca] flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-[#f87171] shrink-0" />
              <span>{pattern}</span>
            </div>
          )}

          {resultMessage && (
            <div className="p-2.5 bg-[#262626] border border-[#22c55e] rounded text-[#86efac] flex items-center space-x-2">
              <Check className="w-4 h-4 text-[#4ade80] shrink-0" />
              <span>{resultMessage}</span>
            </div>
          )}

          {pattern instanceof RegExp && (
            <div className="space-y-1.5">
              <div className="text-[#aaaaaa]">
                {preview.total
                  ? L("{occ} occurrence(s) sur {total} ligne(s){v}", { occ: preview.occ, total: preview.total, v: preview.total > PREVIEW_MAX ? ` (aperçu des ${PREVIEW_MAX} premières)` : '' })
                  : L("Aucune occurrence dans les traductions.")}
              </div>
              {preview.lines.length > 0 && (
                <div className="border border-[#2e2e2e] rounded divide-y divide-[#2e2e2e] max-h-72 overflow-y-auto select-text">
                  {preview.lines.map(({ rec, after }) => (
                    <div key={rec.id} className="p-2 space-y-0.5">
                      <div className="text-[12px] text-[#888888] font-mono">
                        {rec.recordType}
                        {rec.field ? ` ${rec.field}` : ''} · {rec.formId}
                      </div>
                      <div className="text-[#fca5a5] line-through decoration-[#7f1d1d] break-words">{rec.target}</div>
                      <div className="text-[#86efac] break-words">{after}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pied de page */}
        <div className="h-12 shrink-0 border-t border-[#333333] px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 bg-[#2c2c2c] hover:bg-[#404040] text-white rounded transition-colors">{L("Fermer")}</button>
            <button
              type="button"
              onClick={() => {
                onUndo();
                setResultMessage(L("Dernier remplacement annulé."));
              }}
              disabled={!canUndo}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2c2c2c] hover:bg-[#404040] text-white rounded transition-colors disabled:opacity-40"
            >
              <Undo2 className="w-3.5 h-3.5" />{L("Annuler le remplacement")}</button>
          </div>
          <button
            type="button"
            onClick={handleExecuteReplace}
            disabled={!preview.total}
            className="px-4 py-1.5 bg-[#22c55e] hover:bg-[#16a34a] text-white font-medium rounded transition-colors disabled:opacity-50"
          >{L("Remplacer tout")}</button>
        </div>
      </div>
    </div>
  );
};
