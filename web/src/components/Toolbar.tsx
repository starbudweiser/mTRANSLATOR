/**
 * Barre d'outils mTRANSLATOR
 * Reproduction fidèle du design conçu par Codex :
 * - Bouton [📁 Ouvrir] bleu vif
 * - Boutons gris épurés avec bordures fines : [📤 Enregistrer], [🌐 Google], [↩ Annuler], [📚 Dictionnaires], [≡ Toutes ∨]
 * - Champ de recherche intégré [🔍 Rechercher]
 * - Raccourcis complémentaires sur la droite
 */

import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  Upload, 
  Globe, 
  RotateCcw, 
  BookMarked, 
  SlidersHorizontal, 
  Search, 
  ChevronDown,
  FileText,
  Layers,
  Sparkles,
  BarChart3,
  GitCompare,
  Check,
  AlertTriangle,
  Database,
  Info
} from 'lucide-react';
import { FilterOptions, TranslationStats } from '../types';
import { localDictStore } from '../utils/localDictionaryStore';
import { useI18n } from '../i18n/LanguageContext';

interface ToolbarProps {
  stats: TranslationStats;
  filter: FilterOptions;
  recordTypes: string[];
  /** Nombre de chaînes de scripts (VMAD) du plugin ouvert. */
  scriptCount?: number;
  isFileLoaded: boolean;
  onFilterChange: (newFilter: FilterOptions) => void;
  onOpenSample: (sampleKey: 'skyrim' | 'fallout' | 'starfield') => void;
  onOpenFileClick: () => void;
  onSave: () => void;
  onExport: (format: 'SST' | 'TXT' | 'CSV' | 'JSON' | 'XML') => void;
  /** Import d'un XML xTranslator dans le plugin ouvert. */
  onImportXml: () => void;
  onOpenDictionaryModal: () => void;
  onOpenAiTranslateModal: () => void;
  onOpenFindReplaceModal: () => void;
  onOpenStatsModal: () => void;
  onOpenDiffModal: () => void;
  onOpenBatchModal: () => void;
  onOpenAbout?: () => void;
  onValidateAndNext: () => void;
  onUndo?: () => void;
  /** Traduction par les dictionnaires SST (xtcore), si disponible. */
  onXtTranslate?: () => void;
  /** Mode simple : barre réduite aux actions essentielles, libellés explicites. */
  simple?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  stats,
  filter,
  recordTypes,
  scriptCount = 0,
  isFileLoaded,
  onFilterChange,
  onOpenSample,
  onOpenFileClick,
  onSave,
  onExport,
  onImportXml,
  onOpenDictionaryModal,
  onOpenAiTranslateModal,
  onOpenFindReplaceModal,
  onOpenStatsModal,
  onOpenDiffModal,
  onOpenBatchModal,
  onOpenAbout,
  onValidateAndNext,
  onUndo,
  onXtTranslate,
  simple = false,
}) => {
  const { t, targetLang } = useI18n();
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [showOpenMenu, setShowOpenMenu] = useState(false);
  const [localStats, setLocalStats] = useState(localDictStore.getStats());

  useEffect(() => {
    const unsub = localDictStore.subscribe(() => {
      setLocalStats(localDictStore.getStats());
    });
    return unsub;
  }, []);

  // Libellé actif du filtre
  const getFilterLabel = () => {
    if (filter.onlyWarnings) return `${t('toolbar.filterWarnings')} (${stats.warningsCount})`;
    if (filter.status === 'untranslated') return `${t('toolbar.filterUntranslated')} (${stats.untranslated})`;
    if (filter.status === 'translated') return `${t('toolbar.filterTranslated')} (${stats.translated})`;
    if (filter.status === 'partial') return `${t('toolbar.filterPartial')} (${stats.partial})`;
    if (filter.recordType) return `Type: ${filter.recordType}`;
    return t('toolbar.filterAll');
  };

  if (simple) {
    const btn = 'flex items-center gap-2 px-3.5 py-2 bg-[#222222] hover:bg-[#303030] text-[#dddddd] hover:text-white border border-[#333333] rounded-md transition-colors';
    const seg = (active: boolean) =>
      `px-3 py-1.5 rounded transition-colors ${active ? 'bg-[#0369a1] text-white font-semibold' : 'text-[#aaaaaa] hover:text-white'}`;
    const onlyTodo = filter.status === 'untranslated' && !filter.onlyWarnings;
    return (
      <div data-fit className="bg-[#181818] border-b border-[#2e2e2e] px-4 py-2.5 flex items-center gap-3 whitespace-nowrap select-none text-[15px]">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onOpenFileClick} className="flex items-center gap-2 px-4 py-2 bg-[#0369a1] text-white font-semibold rounded-md shadow-sm" title="Ouvrir un plugin (.esp, .esm, .esl) ou un fichier de chaînes">
            <Folder className="w-4 h-4" />
            <span>{t('toolbar.open')}</span>
          </button>
          {isFileLoaded && (
            <>
              <button type="button" onClick={onSave} className={btn} title="Enregistrer le plugin traduit (⌘S)">
                <Upload className="w-4 h-4 text-[#aaaaaa]" />
                <span>{t('toolbar.save')}</span>
              </button>
              <span className="block w-px h-6 bg-[#333333] mx-1" />
              {onXtTranslate && (
                <button type="button" onClick={onXtTranslate} className={btn} title="Remplir avec les traductions connues des dictionnaires SST">
                  <BookMarked className="w-4 h-4 text-[#4ade80]" />
                  <span>Traductions connues</span>
                </button>
              )}
              <button type="button" onClick={onOpenAiTranslateModal} className={btn} title="Traduire automatiquement les textes restants">
                <Sparkles className="w-4 h-4 text-[#38bdf8]" />
                <span>Traduire automatiquement</span>
              </button>
              <button type="button" onClick={onUndo} className={btn} title="Annuler la dernière action (⌘Z)">
                <RotateCcw className="w-4 h-4 text-[#aaaaaa]" />
                <span>{t('toolbar.undo')}</span>
              </button>
              <span className="block w-px h-6 bg-[#333333] mx-1" />
              <div className="flex items-center bg-[#222222] border border-[#333333] rounded-md p-0.5" role="group" aria-label="Lignes affichées">
                <button type="button" className={seg(onlyTodo)} onClick={() => onFilterChange({ ...filter, status: 'untranslated', onlyWarnings: false, recordType: 'all' })}>
                  À traduire ({stats.untranslated})
                </button>
                <button type="button" className={seg(!onlyTodo)} onClick={() => onFilterChange({ ...filter, status: 'all', onlyWarnings: false, recordType: 'all' })}>
                  Tout ({stats.total})
                </button>
              </div>
            </>
          )}
        </div>
        {isFileLoaded && (
          <div className="ml-auto flex items-center gap-3">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-[#666666] absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                value={filter.searchQuery}
                onChange={(e) => onFilterChange({ ...filter, searchQuery: e.target.value })}
                placeholder="Chercher un texte"
                className="bg-[#181818] border border-[#333333] text-[15px] text-[#dddddd] pl-8 pr-7 py-2 rounded-md focus:border-[#0ea5e9] focus:outline-none w-52 placeholder-[#666666]"
              />
              {filter.searchQuery && (
                <button type="button" onClick={() => onFilterChange({ ...filter, searchQuery: '' })} className="absolute right-2 text-[#666666] hover:text-white text-[13px]">✕</button>
              )}
            </div>
          <button
            type="button"
            onClick={onValidateAndNext}
            className="flex items-center gap-2 px-4 py-2 bg-[#14391f] hover:bg-[#1a4a28] text-[#86efac] border border-[#22c55e] rounded-md font-semibold transition-colors shrink-0"
            title="Valider la traduction de la ligne et passer à la suivante (F10 / ⌘↵)"
          >
            <Check className="w-4 h-4" />
            <span>Valider et suivant</span>
            <span className="text-[12px] font-mono bg-[#222222] px-1 rounded text-[#86efac]">F10</span>
          </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-fit className="bg-[#181818] border-b border-[#2e2e2e] px-3 py-1.5 flex items-center justify-between gap-3 whitespace-nowrap select-none text-xs">
      {/* Groupe gauche des boutons du design Codex */}
      <div className="flex items-center space-x-2">
        {/* 1. Bouton [📁 Ouvrir] bleu vif */}
        <div className="relative">
          <button
            type="button"
            onClick={onOpenFileClick}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-[#0369a1] hover:bg-[#0369a1] text-white font-semibold rounded shadow-sm transition-all"
            title="Ouvrir un fichier .strings, .dlstrings, .ilstrings, .esp, .esm ou .pex"
          >
            <Folder className="w-3.5 h-3.5 fill-white/20" />
            <span>{t('toolbar.open')}</span>
          </button>
        </div>

        {/* 2. Bouton [📤 Enregistrer] gris épuré avec menu d'export */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSaveMenu(!showSaveMenu)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] hover:text-white border border-[#333333] rounded transition-colors"
            title="Enregistrer les modifications (⌘S) / Exporter"
          >
            <Upload className="w-3.5 h-3.5 text-[#aaaaaa]" />
            <span>{t('toolbar.save')}</span>
            <ChevronDown className="w-3 h-3 text-[#666666] ml-0.5" />
          </button>

          {showSaveMenu && (
            <div 
              className="absolute left-0 mt-1 w-56 bg-[#1e1e1e] border border-[#333333] rounded shadow-2xl py-1 z-50 text-[#dddddd]"
              onMouseLeave={() => setShowSaveMenu(false)}
            >
              <div className="px-3 py-1 text-[12px] font-semibold text-[#666666] uppercase tracking-wider">
                Sauvegarde & Formats
              </div>
              <button
                type="button"
                onClick={() => {
                  onSave();
                  setShowSaveMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between text-[#38bdf8] font-medium"
              >
                <span>{t('toolbar.savePlugin')}</span>
                <span className="text-[11px] bg-[#0c3a52] text-[#38bdf8] px-1.5 py-0.5 rounded border border-[#0369a1]/40">ESP</span>
              </button>
              <div className="border-t border-[#2e2e2e] my-1" />
              <button
                type="button"
                onClick={() => {
                  onExport('SST');
                  setShowSaveMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between"
              >
                <span>{t('toolbar.exportSst')}</span>
                <span className="text-[12px] text-[#aaaaaa]">.sst</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onExport('TXT');
                  setShowSaveMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between"
              >
                <span>{t('toolbar.exportTxt')}</span>
                <span className="text-[12px] text-[#aaaaaa]">.txt</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onExport('CSV');
                  setShowSaveMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between"
              >
                <span>{t('toolbar.exportCsv')}</span>
                <span className="text-[12px] text-[#aaaaaa]">.csv</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onExport('JSON');
                  setShowSaveMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between"
              >
                <span>{t('toolbar.exportJson')}</span>
                <span className="text-[12px] text-[#aaaaaa]">.json</span>
              </button>
              <div className="border-t border-[#2e2e2e] my-1" />
              <button
                type="button"
                onClick={() => {
                  onExport('XML');
                  setShowSaveMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between"
              >
                <span>{t('toolbar.exportXml')}</span>
                <span className="text-[12px] text-[#aaaaaa]">.xml</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onImportXml();
                  setShowSaveMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between"
              >
                <span>{t('toolbar.importXml')}</span>
                <span className="text-[12px] text-[#aaaaaa]">.xml</span>
              </button>
            </div>
          )}
        </div>

        {/* 3. Bouton [🌐 Google] pour traduction IA / Google */}
        <button
          type="button"
          onClick={onOpenAiTranslateModal}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] hover:text-white border border-[#333333] rounded transition-colors"
          title="Traduction automatique Google / IA avec respect des balises Bethesda"
        >
          <Globe className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>Google</span>
        </button>

        {/* 4. Bouton [↩ Annuler] */}
        <button
          type="button"
          onClick={onUndo}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] hover:text-white border border-[#333333] rounded transition-colors"
          title="Annuler la dernière action (⌘Z)"
        >
          <RotateCcw className="w-3.5 h-3.5 text-[#aaaaaa]" />
          <span>{t('toolbar.undo')}</span>
        </button>

        {/* 5. Bouton [📚 Dictionnaires] avec indicateur base locale auto-alimentée */}
        <button
          type="button"
          onClick={onOpenDictionaryModal}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] hover:text-white border border-[#333333] rounded transition-colors"
          title={`Base de données & Dictionnaires (${localStats.totalEntries} entrées, dont ${localStats.userLearnedEntries} auto-apprises)`}
        >
          <BookMarked className="w-3.5 h-3.5 text-[#fbbf24]" />
          <span>{t('toolbar.dictionaries')}</span>
          {localStats.totalEntries === 0 ? (
            <span className="px-1.5 py-0.2 rounded-full bg-[#262626] text-[#aaaaaa] text-[11px] font-mono border border-[#444444]">
              0
            </span>
          ) : localStats.userLearnedEntries > 0 ? (
            <span className="px-1.5 py-0.2 rounded-full bg-[#0369a1]/30 text-[#38bdf8] text-[11px] font-mono border border-[#0369a1]/40">
              +{localStats.userLearnedEntries}
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded-full bg-[#14391f]/30 text-[#4ade80] text-[11px] font-mono border border-[#22c55e]/40">
              {localStats.totalEntries}
            </span>
          )}
        </button>

        {/* 6. Bouton [≡ Toutes ∨] (Menu déroulant de filtre) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] hover:text-white border border-[#333333] rounded transition-colors"
            title="Filtrer les enregistrements"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#aaaaaa]" />
            <span>{getFilterLabel()}</span>
            <ChevronDown className="w-3 h-3 text-[#666666]" />
          </button>

          {showFilterMenu && (
            <div 
              className="absolute left-0 mt-1 w-52 bg-[#1e1e1e] border border-[#333333] rounded shadow-2xl py-1 z-50 text-[#dddddd]"
              onMouseLeave={() => setShowFilterMenu(false)}
            >
              <div className="px-3 py-1 text-[12px] font-semibold text-[#666666] uppercase tracking-wider">
                Filtrer par statut
              </div>
              <button
                type="button"
                onClick={() => {
                  onFilterChange({ ...filter, status: 'all', onlyWarnings: false, recordType: 'all' });
                  setShowFilterMenu(false);
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between ${filter.status === 'all' && !filter.onlyWarnings ? 'text-[#38bdf8] font-semibold' : ''}`}
              >
                <span>Toutes les chaînes</span>
                <span className="text-[12px] text-[#aaaaaa]">{stats.total}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onFilterChange({ ...filter, status: 'untranslated', onlyWarnings: false });
                  setShowFilterMenu(false);
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between ${filter.status === 'untranslated' ? 'text-[#f87171] font-semibold' : ''}`}
              >
                <span className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
                  <span>Non traduit</span>
                </span>
                <span className="text-[12px] text-[#aaaaaa]">{stats.untranslated}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onFilterChange({ ...filter, status: 'translated', onlyWarnings: false });
                  setShowFilterMenu(false);
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between ${filter.status === 'translated' ? 'text-[#4ade80] font-semibold' : ''}`}
              >
                <span className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                  <span>Traduit & validé</span>
                </span>
                <span className="text-[12px] text-[#aaaaaa]">{stats.translated}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onFilterChange({ ...filter, status: 'partial', onlyWarnings: false });
                  setShowFilterMenu(false);
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between ${filter.status === 'partial' ? 'text-[#fbbf24] font-semibold' : ''}`}
              >
                <span className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                  <span>Partiel</span>
                </span>
                <span className="text-[12px] text-[#aaaaaa]">{stats.partial}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onFilterChange({ ...filter, onlyWarnings: true });
                  setShowFilterMenu(false);
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between ${filter.onlyWarnings ? 'text-[#d97706] font-semibold' : ''}`}
              >
                <span className="flex items-center space-x-2">
                  <AlertTriangle className="w-3 h-3 text-[#d97706]" />
                  <span>Alertes balises</span>
                </span>
                <span className="text-[12px] text-[#aaaaaa]">{stats.warningsCount}</span>
              </button>

              {scriptCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onFilterChange({ ...filter, showScripts: !filter.showScripts });
                    setShowFilterMenu(false);
                  }}
                  title="Propriétés texte des scripts Papyrus. Souvent des identifiants internes : ne traduire que les textes affichés en jeu."
                  className={`w-full text-left px-3 py-1.5 hover:bg-[#2c2c2c] flex items-center justify-between ${filter.showScripts ? 'text-[#38bdf8] font-semibold' : ''}`}
                >
                  <span>{filter.showScripts ? '✓ ' : ''}Chaînes de scripts (VMAD)</span>
                  <span className="text-[12px] text-[#aaaaaa]">{scriptCount}</span>
                </button>
              )}

              {recordTypes.length > 0 && (
                <>
                  <div className="border-t border-[#2e2e2e] my-1" />
                  <div className="px-3 py-1 text-[12px] font-semibold text-[#666666] uppercase tracking-wider">
                    Type de Record
                  </div>
                  {recordTypes.slice(0, 8).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        onFilterChange({ ...filter, recordType: filter.recordType === t ? '' : t });
                        setShowFilterMenu(false);
                      }}
                      className={`w-full text-left px-3 py-1 hover:bg-[#2c2c2c] flex items-center justify-between text-[13px] ${filter.recordType === t ? 'text-[#38bdf8] font-semibold' : ''}`}
                    >
                      <span>{t}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* 7. Champ [🔍 Rechercher] */}
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={filter.searchQuery}
            onChange={(e) => onFilterChange({ ...filter, searchQuery: e.target.value })}
            placeholder="Rechercher"
            className="bg-[#181818] border border-[#333333] text-xs text-[#dddddd] pl-8 pr-2.5 py-1.5 rounded focus:border-[#0ea5e9] focus:outline-none w-52 placeholder-[#666666] transition-colors"
          />
          {filter.searchQuery && (
            <button
              type="button"
              onClick={() => onFilterChange({ ...filter, searchQuery: '' })}
              className="absolute right-2 text-[#666666] hover:text-white text-[13px]"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Groupe droit des actions complémentaires */}
      <div className="flex items-center space-x-2">
        {isFileLoaded && (
          <>
            {/* Valider & Suivant F10 */}
            <button
              type="button"
              onClick={onValidateAndNext}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#2c2c2c] hover:bg-[#404040] text-[#4ade80] border border-[#22c55e] rounded font-medium transition-colors"
              title="Valider la ligne courante et passer au suivant (F10 / ⌘↵)"
            >
              <span>Valider</span>
              <span className="text-[12px] font-mono bg-[#222222] px-1 py-0.2 rounded text-[#86efac]">F10</span>
            </button>

            {/* Rechercher et remplacer dans les traductions */}
            <button
              type="button"
              onClick={onOpenFindReplaceModal}
              className="p-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] border border-[#333333] rounded transition-colors"
              title="Rechercher et remplacer dans les traductions"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#4ade80]" />
            </button>

            {/* Statistiques et Rapport */}
            <button
              type="button"
              onClick={onOpenStatsModal}
              className="p-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] border border-[#333333] rounded transition-colors"
              title="Statistiques et rapport"
            >
              <BarChart3 className="w-3.5 h-3.5 text-[#38bdf8]" />
            </button>

            {/* Comparateur Diff */}
            <button
              type="button"
              onClick={onOpenDiffModal}
              className="p-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] border border-[#333333] rounded transition-colors"
              title="Comparer avec une autre version (Diff)"
            >
              <GitCompare className="w-3.5 h-3.5 text-[#f87171]" />
            </button>
          </>
        )}

        {/* Traduction automatique de plusieurs plugins */}
        <button
          type="button"
          onClick={onOpenBatchModal}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] border border-[#333333] rounded transition-colors text-xs font-medium"
          title="Traduire plusieurs plugins d'un coup avec les dictionnaires SST"
        >
          <Layers className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>Traitement par Lots</span>
        </button>

        {/* Bouton À propos */}
        {onOpenAbout && (
          <button
            type="button"
            onClick={onOpenAbout}
            className="flex items-center space-x-1 px-2 py-1.5 bg-[#222222] hover:bg-[#303030] text-[#dddddd] hover:text-white border border-[#333333] rounded transition-colors text-xs"
            title="À propos de mTRANSLATOR (Informations & Crédits)"
          >
            <Info className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span>À propos</span>
          </button>
        )}
      </div>
    </div>
  );
};
