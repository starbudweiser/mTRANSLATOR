/**
 * Tableau des chaînes de traduction mTRANSLATOR macOS
 * Conçu dans le style épuré et plat de Fusion Dossier / FOMOD Simulator.
 * Prise en charge de la sélection au clavier, du tri, de la coloration des balises
 * et diagnostic clair des raisons pour lesquelles chaque ligne n'est pas traduite.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ModRecord, RecordStatus, DictionaryEntry } from '../types';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Circle, 
  Clock, 
  Tag, 
  Lock, 
  HelpCircle, 
  Sparkles, 
  Zap, 
  BookMarked,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import { getRecordDiagnostic, buildDictionaryLookup } from '../utils/recordDiagnostics';
import { useI18n } from '../i18n/LanguageContext';
import { L } from '../i18n/L';

interface StringTableProps {
  records: ModRecord[];
  selectedId: string | null;
  onSelectRecord: (record: ModRecord) => void;
  sortBy: 'formId' | 'recordType' | 'status' | 'source';
  sortDirection: 'asc' | 'desc';
  onSort: (column: 'formId' | 'recordType' | 'status' | 'source') => void;
  dictionaries?: DictionaryEntry[];
  onQuickApplySuggestion?: (recordId: string, suggestion: string) => void;
  onApplyExactSstMatches?: () => void;
  /** Traduction auto par xtcore (exacte + approchante), app macOS seulement. */
  onXtTranslate?: () => void;
  onOpenAiTranslateModal?: () => void;
  /** Mode simple : masque les colonnes techniques (FormID, Type, Editor ID). */
  simple?: boolean;
}

export const StringTable: React.FC<StringTableProps> = ({
  records,
  selectedId,
  onSelectRecord,
  sortBy,
  sortDirection,
  onSort,
  dictionaries = [],
  onQuickApplySuggestion,
  onApplyExactSstMatches,
  onXtTranslate,
  simple = false,
  onOpenAiTranslateModal,
}) => {
  const { t, targetLang } = useI18n();
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const [showDiagnosticHelp, setShowDiagnosticHelp] = useState(false);
  const [pageSize, setPageSize] = useState<number>(100);
  const [currentPage, setCurrentPage] = useState<number>(0);

  // Table de recherche rapide O(1) pour les dictionnaires en mémoire
  const dictLookup = useMemo(() => buildDictionaryLookup(dictionaries), [dictionaries]);

  // Pagination calculée
  const totalPages = pageSize > 0 ? Math.ceil(records.length / pageSize) : 1;

  // Défilement et synchronisation automatique de page vers la ligne sélectionnée
  useEffect(() => {
    if (selectedId && pageSize > 0) {
      const idx = records.findIndex((r) => r.id === selectedId);
      if (idx !== -1) {
        const pageOfRecord = Math.floor(idx / pageSize);
        if (pageOfRecord !== currentPage) {
          setCurrentPage(pageOfRecord);
        }
      }
    }
  }, [selectedId, records, pageSize, currentPage]);

  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(Math.max(0, totalPages - 1));
    }
  }, [totalPages, currentPage]);

  const displayedRecords = useMemo(() => {
    if (pageSize <= 0 || records.length <= pageSize) return records;
    const start = currentPage * pageSize;
    return records.slice(start, start + pageSize);
  }, [records, currentPage, pageSize]);

  // Défilement automatique vers la ligne sélectionnée dans le conteneur
  useEffect(() => {
    if (selectedRowRef.current && tableContainerRef.current) {
      selectedRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedId, currentPage]);

  // Rendu des balises avec coloration syntaxique
  const renderHighlightedText = (text: string) => {
    if (!text) return <span className="text-[#666666] italic">{L("Vide")}</span>;

    // Découpage pour mettre en valeur [pagebreak], les balises <...> et %s
    const parts = text.split(/(\[\s*pagebreak\s*\]|<pagebreak>|\[\s*saut\s*de\s*page\s*\]|<[^>]+>|%[0-9.]*[sdifu]|\\r\\n|\\n)/gi);

    return (
      <span>
        {parts.map((part, index) => {
          // Saut de page de livre Bethesda : [pagebreak]
          if (/^\[\s*pagebreak\s*\]$/i.test(part) || /^<pagebreak>$/i.test(part)) {
            return (
              <span
                key={index}
                className="bg-[#3f2a0c] text-[#fbbf24] font-mono font-semibold text-[12px] px-1.5 py-0.5 rounded border border-[#f59e0b] mx-1 inline-flex items-center space-x-1"
                title={L("Saut de page de livre Bethesda (Ne jamais traduire !)")}
              >
                <span>📖</span>
                <span>{part}</span>
              </span>
            );
          }
          if (part.startsWith('<') && part.endsWith('>')) {
            return (
              <span
                key={index}
                className="bg-[#262626] text-[#38bdf8] font-mono text-[12px] px-1 py-0.5 rounded border border-[#444444] mx-0.5 inline-block"
                title={L("Balise de jeu préservée")}
              >
                {part}
              </span>
            );
          }
          if (part.startsWith('%')) {
            return (
              <span
                key={index}
                className="bg-[#0c3a52] text-[#38bdf8] font-mono text-[12px] px-1 py-0.5 rounded border border-[#0369a1] mx-0.5 inline-block"
                title={L("Spécificateur de variable C/Papyrus")}
              >
                {part}
              </span>
            );
          }
          if (part === '\\r\\n' || part === '\\n') {
            return (
              <span
                key={index}
                className="text-[#fbbf24] font-mono text-[12px] opacity-70 px-0.5"
                title={L("Saut de ligne")}
              >
                ↵
              </span>
            );
          }
          return <span key={index}>{part}</span>;
        })}
      </span>
    );
  };

  const getStatusIcon = (status: RecordStatus, hasWarning: boolean) => {
    if (hasWarning) {
      return (
        <span className="flex items-center justify-center w-4 h-4 rounded bg-[#3f2a0c] border border-[#f59e0b] text-[#fbbf24]" title={L("Alerte : balises divergentes")}>
          <AlertTriangle className="w-2.5 h-2.5" />
        </span>
      );
    }
    switch (status) {
      case 'translated':
        return (
          <span className="flex items-center justify-center w-4 h-4 rounded bg-[#262626] border border-[#22c55e] text-[#4ade80]" title={L("Traduit et validé")}>
            <CheckCircle2 className="w-2.5 h-2.5" />
          </span>
        );
      case 'untranslated':
        return (
          <span className="flex items-center justify-center w-4 h-4 rounded bg-[#4a1c1c] border border-[#ef4444] text-[#f87171]" title={L("Non traduit")}>
            <Circle className="w-2.5 h-2.5 fill-current" />
          </span>
        );
      case 'partial':
        return (
          <span className="flex items-center justify-center w-4 h-4 rounded bg-[#3f2a0c] border border-[#f59e0b] text-[#fbbf24]" title={L("Traduit partiellement / En cours")}>
            <Clock className="w-2.5 h-2.5" />
          </span>
        );
      case 'identical':
        return (
          <span className="flex items-center justify-center w-4 h-4 rounded bg-[#0c3a52] border border-[#0369a1] text-[#38bdf8]" title={L("Identique à l'original (ex: nom propre)")}>
            <Tag className="w-2.5 h-2.5" />
          </span>
        );
      case 'locked':
        return (
          <span className="flex items-center justify-center w-4 h-4 rounded bg-[#262626] border border-[#444444] text-[#aaaaaa]" title={L("Verrouillé")}>
            <Lock className="w-2.5 h-2.5" />
          </span>
        );
    }
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'QUST': return 'bg-[#0c3a52] text-[#38bdf8] border-[#0369a1]';
      case 'DIAL':
      case 'INFO': return 'bg-[#0c3a52] text-[#38bdf8] border-[#0369a1]';
      case 'WEAP': return 'bg-[#4a1c1c] text-[#f87171] border-[#ef4444]';
      case 'ARMO': return 'bg-[#262626] text-[#4ade80] border-[#22c55e]';
      case 'BOOK': return 'bg-[#3f2a0c] text-[#fbbf24] border-[#f59e0b]';
      case 'MCM': return 'bg-[#0c3a52] text-[#38bdf8] border-[#0369a1]';
      case 'MESG': return 'bg-[#0c4a6e] text-[#38bdf8] border-[#0369a1]';
      default: return 'bg-[#222222] text-[#aaaaaa] border-[#444444]';
    }
  };

  // Statistiques rapides de diagnostic sans calculs lourds redondants
  const { exactMatchesCount, fuzzyMatchesCount, unseenModCount, untranslatedCount } = useMemo(() => {
    let exact = 0;
    let fuzzy = 0;
    let unseen = 0;
    let untranslated = 0;

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r.target || r.target.trim() === '') {
        untranslated++;
        const trimmed = r.source.trim().toLowerCase();
        if (dictLookup.has(trimmed)) {
          exact++;
        } else if (r.fuzzyMatch && r.fuzzyMatch >= 70) {
          fuzzy++;
        } else {
          unseen++;
        }
      }
    }
    return {
      exactMatchesCount: exact,
      fuzzyMatchesCount: fuzzy,
      unseenModCount: unseen,
      untranslatedCount: untranslated,
    };
  }, [records, dictLookup]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#181818]">
      {/* Barre d'explication / indicateurs de statut pour les lignes non traduites */}
      {untranslatedCount > 0 && !simple && (
        <div className="bg-[#181818] border-b border-[#2e2e2e] px-3 py-1.5 flex items-center justify-between text-[13px] text-[#aaaaaa]">
          <div className="flex items-center space-x-2 flex-wrap">
            <span className="text-[#dddddd] font-medium flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-[#ef4444] inline-block" />
              <span>{L("Diagnostic des")} {untranslatedCount} {L("ligne(s) non traduite(s) :")}</span>
            </span>

            {onXtTranslate && (
              <button
                type="button"
                onClick={onXtTranslate}
                className="px-2.5 py-0.5 rounded bg-[#14391f] hover:bg-[#14391f] border border-[#22c55e] text-[#86efac] hover:text-white flex items-center space-x-1 font-medium shadow-sm transition-all cursor-pointer group"
                title={L("Traduction automatique par les dictionnaires SST de xTranslator (correspondances exactes et approchantes)")}
              >
                <BookMarked className="w-3.5 h-3.5 text-[#4ade80] group-hover:scale-110 transition-transform" />
                <span className="font-semibold">{L("⚡ Traduire avec les dictionnaires SST")}</span>
              </button>
            )}

            {!onXtTranslate && exactMatchesCount > 0 && (
              <button
                type="button"
                onClick={onApplyExactSstMatches}
                className="px-2.5 py-0.5 rounded bg-[#14391f] hover:bg-[#14391f] border border-[#22c55e] text-[#86efac] hover:text-white flex items-center space-x-1 font-medium shadow-sm transition-all cursor-pointer group"
                title={L("Appliquer immédiatement toutes les {exactMatchesCount} correspondances exactes du dictionnaire SST (0 ms)", { exactMatchesCount })}
              >
                <BookMarked className="w-3.5 h-3.5 text-[#4ade80] group-hover:scale-110 transition-transform" />
                <span className="font-semibold">{L("⚡ Appliquer")} {exactMatchesCount} {L("traduction(s) SST (100%)")}</span>
              </button>
            )}

            {fuzzyMatchesCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-[#3f2a0c]/80 border border-[#f59e0b]/60 text-[#fde68a] flex items-center space-x-1 font-medium">
                <span>🔍</span>
                <span>{fuzzyMatchesCount} {L("suggestion(s) SST partielle(s) (> 70%)")}</span>
              </span>
            )}

            {unseenModCount > 0 && (
              <button
                type="button"
                onClick={onOpenAiTranslateModal}
                className="px-2.5 py-0.5 rounded bg-[#1e1e1e] hover:bg-[#0c3a52] border border-[#0369a1] text-[#dddddd] hover:text-white flex items-center space-x-1 font-medium shadow-sm transition-all cursor-pointer group"
                title={L("Ouvrir la Traduction Automatique par IA pour les textes inédits du mod")}
              >
                <Sparkles className="w-3.5 h-3.5 text-[#38bdf8] group-hover:scale-110 transition-transform" />
                <span>{L("Traduire")} {unseenModCount} {L("texte(s) inédit(s) par IA")}</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowDiagnosticHelp(!showDiagnosticHelp)}
            className="flex items-center space-x-1 text-[#38bdf8] hover:text-[#38bdf8] transition-colors ml-2 shrink-0"
            title={L("Afficher l'explication détaillée de chaque indicateur")}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{L("Pourquoi ces lignes ?")}</span>
          </button>
        </div>
      )}

      {/* Volet déroulant explicatif si l'utilisateur clique */}
      {showDiagnosticHelp && (
        <div className="bg-[#1e1e1e] border-b border-[#333333] p-3 text-xs text-[#dddddd] animate-in fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-white flex items-center space-x-1.5">
              <HelpCircle className="w-4 h-4 text-[#38bdf8]" />
              <span>{L("Pourquoi certaines lignes restent-elles non traduites après confirmation ?")}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowDiagnosticHelp(false)}
              className="text-[#aaaaaa] hover:text-white text-[13px]"
            >{L("Fermer ✕")}</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[13px] leading-relaxed">
            <div className="p-2 rounded bg-[#181818] border border-[#2e2e2e]">
              <span className="font-semibold text-[#4ade80] block mb-1">{L("📖 1. Correspondance SST exacte (100%)")}</span>
              <p className="text-[#aaaaaa]">{L("La phrase existe à l'identique dans un dictionnaire SST chargé. Si vous confirmez la traduction par dictionnaire, ces lignes sont instantanément comblées.")}</p>
            </div>
            <div className="p-2 rounded bg-[#181818] border border-[#2e2e2e]">
              <span className="font-semibold text-[#fde68a] block mb-1">{L("🔍 2. Correspondance partielle (Fuzzy Match)")}</span>
              <p className="text-[#aaaaaa]">{L("Le dictionnaire contient une phrase proche (ex: 85%), mais pas strictement identique. mTRANSLATOR ne l'applique pas d'office pour vous éviter des faux-sens. Vous pouvez l'appliquer via l'icône ⚡.")}</p>
            </div>
            <div className="p-2 rounded bg-[#181818] border border-[#2e2e2e]">
              <span className="font-semibold text-[#38bdf8] block mb-1">{L("✨ 3. Textes inédits du mod (0% SST)")}</span>
              <p className="text-[#aaaaaa]">{L("Ces dialogues, quêtes ou livres ont été écrits par l'auteur du mod et n'existent dans aucun fichier du jeu original. Ils nécessitent la Traduction IA (Gemini) ou une saisie manuelle.")}</p>
            </div>
          </div>
        </div>
      )}

      {/* Conteneur du tableau */}
      <div 
        ref={tableContainerRef}
        className="flex-1 overflow-auto select-none text-xs border-b border-[#333333] custom-scrollbar"
      >
        <table className="w-full border-collapse text-left table-fixed">
          <colgroup>
            <col className="w-10" />
            {!simple && (
              <>
                <col className="w-24" />
                <col className="w-16" />
                <col className="w-40" />
              </>
            )}
            <col className={simple ? 'w-[calc(50%-1.25rem)]' : 'w-[calc(50%-10rem)]'} />
            <col className={simple ? 'w-[calc(50%-1.25rem)]' : 'w-[calc(50%-10rem)]'} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-[#1e1e1e] border-b border-[#333333] text-[#aaaaaa] text-[13px] font-semibold tracking-wider uppercase">
            <tr>
              <th 
                onClick={() => onSort('status')}
                className="w-10 px-2 py-2 text-center cursor-pointer hover:text-white transition-colors"
                title={L("Statut de traduction")}
              >
                St.
              </th>
              {!simple && (<>
              <th 
                onClick={() => onSort('formId')}
                className="w-24 px-2 py-2 cursor-pointer hover:text-white transition-colors"
              >
                <div className="flex items-center space-x-1">
                  <span>FormID</span>
                  {sortBy === 'formId' && (
                    <span className="text-[#38bdf8]">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </div>
              </th>
              <th 
                onClick={() => onSort('recordType')}
                className="w-16 px-2 py-2 cursor-pointer hover:text-white transition-colors"
              >
                <div className="flex items-center space-x-1">
                  <span>Type</span>
                  {sortBy === 'recordType' && (
                    <span className="text-[#38bdf8]">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </div>
              </th>
              <th className="w-40 px-2 py-2 truncate">
                Editor ID
              </th>
              </>)}
              <th 
                onClick={() => onSort('source')}
                className="px-3 py-2 cursor-pointer hover:text-white transition-colors"
              >
                <div className="flex items-center space-x-1">
                  <span>{L("Original (VO)")}</span>
                  {sortBy === 'source' && (
                    <span className="text-[#38bdf8]">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </div>
              </th>
              <th className="px-3 py-2">{L("Traduction (")}{targetLang}{L(") & Indicateur")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2e2e2e] font-normal">
            {displayedRecords.length === 0 ? (
              <tr>
                <td colSpan={simple ? 3 : 6} className="text-center py-16 text-[#666666]">{L("Aucun enregistrement ne correspond aux filtres actuels.")}</td>
              </tr>
            ) : (
              displayedRecords.map((r) => {
                const isSelected = r.id === selectedId;
                const hasWarning = Boolean(r.tagWarnings && r.tagWarnings.length > 0);
                const diag = getRecordDiagnostic(r, dictionaries, dictLookup);

                return (
                  <tr
                    key={r.id}
                    ref={isSelected ? selectedRowRef : null}
                    onClick={() => onSelectRecord(r)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#2c2c2c] border-l-2 border-l-[#38bdf8] text-white'
                        : 'hover:bg-[#1e1e1e] text-[#dddddd]'
                    }`}
                  >
                    {/* Statut */}
                    <td className="px-2 py-2 text-center align-top">
                      <div className="flex justify-center pt-0.5">
                        {getStatusIcon(r.status, hasWarning)}
                      </div>
                    </td>

                    {!simple && (<>
                    {/* FormID */}
                    <td className="px-2 py-2 font-mono text-[13px] text-[#38bdf8]/90 truncate align-top">
                      {r.formId || '00000000'}
                    </td>

                    {/* Type */}
                    <td className="px-2 py-2 align-top">
                      <span className={`px-1.5 py-0.5 rounded text-[12px] font-mono border inline-block ${getTypeBadgeColor(r.recordType)}`}>
                        {r.recordType}
                      </span>
                    </td>

                    {/* EditorID */}
                    <td className="px-2 py-2 font-mono text-[13px] text-[#aaaaaa] truncate align-top" title={r.edid}>
                      {r.edid || '—'}
                    </td>
                    </>)}

                    {/* Source VO */}
                    <td className="px-3 py-2 align-top text-[14px] border-r border-[#2e2e2e]">
                      <div className="line-clamp-2 leading-relaxed text-[#dddddd]">
                        {renderHighlightedText(r.source)}
                      </div>
                    </td>

                    {/* Target VF & Indicateur clair de statut */}
                    <td className="px-3 py-2 align-top text-[14px]">
                      <div className="leading-relaxed">
                        {r.target ? (
                          <div className="flex items-start justify-between gap-2">
                            <div className="line-clamp-2 text-[#ffffff]">
                              {renderHighlightedText(r.target)}
                            </div>
                            {r.status === 'identical' && (
                              <span className="px-1.5 py-0.5 rounded text-[11px] bg-[#0c3a52] text-[#38bdf8] border border-[#0369a1] whitespace-nowrap shrink-0">{L("Identique")}</span>
                            )}
                          </div>
                        ) : (
                          /* Indicateur clair dans le tableau pour les lignes non traduites */
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            {/* Puce / Badge de diagnostic précis */}
                            <span 
                              className={`px-2 py-0.5 rounded text-[12px] font-medium border flex items-center space-x-1.5 shadow-sm ${diag.badgeClass}`}
                              title={diag.detailedReason}
                            >
                              <span 
                                className="w-1.5 h-1.5 rounded-full shrink-0" 
                                style={{ backgroundColor: diag.dotColor }} 
                              />
                              <span>{diag.shortLabel}</span>
                            </span>

                            {/* Bouton d'application rapide si une suggestion existe */}
                            {diag.canQuickApply && diag.suggestion && onQuickApplySuggestion ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onQuickApplySuggestion(r.id, diag.suggestion!);
                                }}
                                className="px-2 py-0.5 bg-[#222222] hover:bg-[#333333] text-[#4ade80] border border-[#444444] rounded text-[12px] flex items-center space-x-1 transition-colors group shadow-sm"
                                title={L("Cliquer pour appliquer la correspondance SST : « {suggestion} »", { suggestion: diag.suggestion })}
                              >
                                <Zap className="w-2.5 h-2.5 text-[#4ade80] group-hover:scale-110 transition-transform" />
                                <span className="truncate max-w-[220px]">{L("Appliquer : «")} {diag.suggestion} »
                                </span>
                              </button>
                            ) : (
                              <span 
                                className="text-[#666666] italic text-[13px] truncate max-w-[280px]" 
                                title={diag.detailedReason}
                              >
                                {diag.reason === 'UNSEEN_MOD_TEXT' 
                                  ? L("Absent du dictionnaire (Traduction IA requise)") 
                                  : L("[Non traduit]")}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Barre de pagination fluide pour les gros fichiers */}
      {records.length > 50 && (
        <div className="bg-[#1a1a1a] border-t border-[#333333] px-3 py-1.5 flex items-center justify-between text-xs text-[#aaaaaa] shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-[13px]">{L("Lignes")} <strong className="text-white">{pageSize > 0 ? currentPage * pageSize + 1 : 1}</strong> à <strong className="text-white">{pageSize > 0 ? Math.min((currentPage + 1) * pageSize, records.length) : records.length}</strong> {L("sur")} <strong className="text-white">{records.length.toLocaleString()}</strong>
            </span>
          </div>

          {pageSize > 0 && totalPages > 1 && (
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => setCurrentPage(0)}
                disabled={currentPage === 0}
                className="p-1 rounded hover:bg-[#2c2c2c] disabled:opacity-30 disabled:cursor-not-allowed text-[#dddddd] transition-colors"
                title={L("Première page")}
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="p-1 rounded hover:bg-[#2c2c2c] disabled:opacity-30 disabled:cursor-not-allowed text-[#dddddd] transition-colors"
                title={L("Page précédente")}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 py-0.5 font-medium text-white bg-[#181818] border border-[#333333] rounded text-[13px]">{L("Page")} {currentPage + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="p-1 rounded hover:bg-[#2c2c2c] disabled:opacity-30 disabled:cursor-not-allowed text-[#dddddd] transition-colors"
                title={L("Page suivante")}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(totalPages - 1)}
                disabled={currentPage >= totalPages - 1}
                className="p-1 rounded hover:bg-[#2c2c2c] disabled:opacity-30 disabled:cursor-not-allowed text-[#dddddd] transition-colors"
                title={L("Dernière page")}
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-center space-x-2">
            <span className="text-[13px] text-[#666666]">{L("Affichage :")}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const val = Number(e.target.value);
                setPageSize(val);
                setCurrentPage(0);
              }}
              className="bg-[#181818] border border-[#333333] rounded px-2 py-0.5 text-[13px] text-[#dddddd] focus:outline-none focus:border-[#38bdf8]"
            >
              <option value={50}>{L("50 par page")}</option>
              <option value={100}>{L("100 par page")}</option>
              <option value={250}>{L("250 par page")}</option>
              <option value={500}>{L("500 par page")}</option>
              <option value={0}>{L("Tout afficher")}</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
