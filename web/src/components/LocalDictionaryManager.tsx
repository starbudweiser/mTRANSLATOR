/**
 * Onglet & Panneau de gestion du Dictionnaire Local Auto-Alimenté
 * Permet de visualiser, configurer, rechercher et exporter la base de données locale auto-alimentée
 * au fil des traductions et des sauvegardes SST/TXT.
 */

import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Sparkles, 
  Download, 
  Trash2, 
  FolderSearch, 
  RefreshCw, 
  Settings, 
  Layers, 
  CheckCircle2, 
  AlertTriangle,
  FolderOpen,
  ArrowDownToLine,
  FileText,
  Search
} from 'lucide-react';
import { localDictStore, LearnedEntryMeta, LocalDictSettings } from '../utils/localDictionaryStore';
import { triggerFileDownload } from '../utils/translatorUtils';
import { parseMultipleSSTFiles, BatchSSTResult } from '../utils/sstParser';
import { L } from '../i18n/L';

interface LocalDictionaryManagerProps {
  onScanFolderTrigger?: () => void;
  onApplyDictionary?: (matchType: 'exact' | 'fuzzy') => { appliedCount: number } | Promise<{ appliedCount: number }>;
}

export const LocalDictionaryManager: React.FC<LocalDictionaryManagerProps> = ({
  onApplyDictionary,
}) => {
  const [stats, setStats] = useState(localDictStore.getStats());
  const [settings, setSettings] = useState<LocalDictSettings>(localDictStore.getSettings());
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<LearnedEntryMeta[]>(localDictStore.getLearnedEntries());
  const [folderScanStatus, setFolderScanStatus] = useState<string | null>(null);
  const [isScanningFolder, setIsScanningFolder] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const unsub = localDictStore.subscribe(() => {
      setStats(localDictStore.getStats());
      setSettings(localDictStore.getSettings());
      setEntries(localDictStore.getLearnedEntries());
    });
    return unsub;
  }, []);

  const handleToggleSetting = (key: keyof LocalDictSettings) => {
    const updated = { [key]: !settings[key] };
    localDictStore.updateSettings(updated);
  };

  const handleExportJson = () => {
    const jsonStr = localDictStore.exportToJson();
    const date = new Date().toISOString().slice(0, 10);
    triggerFileDownload(jsonStr, `mTranslate_Local_Dictionary_${date}.json`, 'application/json;charset=utf-8');
  };

  const handleClearLearned = () => {
    if (window.confirm(L("Voulez-vous vraiment vider la base locale de dictionnaires auto-appris ? Les dictionnaires officiels Bethesda seront conservés."))) {
      localDictStore.clearLearned();
    }
  };

  const handleDeleteEntry = (source: string) => {
    localDictStore.deleteEntry(source);
  };

  // Traitement d'un dossier sélectionné contenant des SST, TXT ou JSON
  const handleFolderSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsScanningFolder(true);
    setFolderScanStatus(L("Scan du dossier en cours ({length} fichiers détectés)...", { length: files.length }));

    try {
      const fileList = Array.from(files).filter((f) => {
        const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
        return ['.sst', '.txt', '.csv', '.json', '.xml'].includes(ext);
      });

      if (fileList.length === 0) {
        setFolderScanStatus(L("Aucun fichier de dictionnaire compatible (.sst, .txt, .json) trouvé dans le dossier."));
        setIsScanningFolder(false);
        return;
      }

      const report: BatchSSTResult = await parseMultipleSSTFiles(fileList, (progress) => {
        setFolderScanStatus(
          L("Scan en cours : fichier {processedFiles}/{totalFiles} ({percentage}%) - {currentFileName} ({toLocaleString} entrées trouvées)", { processedFiles: progress.processedFiles, totalFiles: progress.totalFiles, percentage: progress.percentage, currentFileName: progress.currentFileName, toLocaleString: progress.entriesFoundSoFar.toLocaleString() })
        );
      });

      setFolderScanStatus(L("Intégration de {toLocaleString} entrées dans la base IndexedDB locale...", { toLocaleString: report.allEntries.length.toLocaleString() }));
      const res = await localDictStore.importEntriesAsync(report.allEntries, 'sst_import');

      setFolderScanStatus(
        L("✅ Dossier scanné : {length} fichiers traités. {toLocaleString} nouvelles entrées ajoutées, {toLocaleString2} mises à jour sans blocage.", { length: report.filesReport.length, toLocaleString: res.added.toLocaleString(), toLocaleString2: res.updated.toLocaleString() })
      );
    } catch (err: any) {
      setFolderScanStatus(L("Erreur lors du scan du dossier : {message}", { message: err.message }));
    } finally {
      setIsScanningFolder(false);
    }
  };

  const filteredEntries = entries.filter((e) => {
    const q = search.toLowerCase();
    return e.source.toLowerCase().includes(q) || e.target.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4 text-xs text-[#dddddd]">
      {/* En-tête stats & synchronisation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-[#181818] border border-[#2e2e2e] p-3 rounded-lg flex items-center justify-between">
          <div>
            <div className="text-[12px] uppercase font-semibold text-[#aaaaaa] tracking-wider">{L("Entrées auto-apprises")}</div>
            <div className="text-xl font-bold text-[#38bdf8] mt-0.5">{stats.userLearnedEntries.toLocaleString()}</div>
            <div className="text-[12px] text-[#aaaaaa] mt-0.5">{L("Alimentées en local")}</div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-[#0369a1]/20 border border-[#0369a1]/40 flex items-center justify-center text-[#38bdf8]">
            <Sparkles className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-[#181818] border border-[#2e2e2e] p-3 rounded-lg flex items-center justify-between">
          <div>
            <div className="text-[12px] uppercase font-semibold text-[#aaaaaa] tracking-wider">{L("Total de la Base Locale")}</div>
            <div className="text-xl font-bold text-[#4ade80] mt-0.5">{stats.totalEntries.toLocaleString()}</div>
            <div className="text-[12px] text-[#aaaaaa] mt-0.5">{L("Scannées en premier")}</div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-[#22c55e]/20 border border-[#22c55e]/40 flex items-center justify-center text-[#4ade80]">
            <Database className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-[#181818] border border-[#2e2e2e] p-3 rounded-lg flex items-center justify-between">
          <div>
            <div className="text-[12px] uppercase font-semibold text-[#aaaaaa] tracking-wider">{L("Dernière mise à jour")}</div>
            <div className="text-xs font-semibold text-[#dddddd] mt-1">
              {stats.lastUpdated !== 'Jamais' ? new Date(stats.lastUpdated).toLocaleDateString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : L("Prête")}
            </div>
            <div className="text-[12px] text-[#aaaaaa] mt-0.5">{L("Persistance locale active")}</div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-[#0369a1]/20 border border-[#0369a1]/40 flex items-center justify-center text-[#38bdf8]">
            <RefreshCw className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Barre d'action rapide : Scan de dossier & Options */}
      <div className="bg-[#1e1e1e] border border-[#2e2e2e] p-3 rounded-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          {/* Bouton pour scanner un dossier de SST / TXT traduits */}
          <label className="cursor-pointer px-3 py-1.5 bg-[#0369a1] hover:bg-[#0369a1] text-white font-medium rounded flex items-center space-x-1.5 transition-colors shadow">
            <FolderOpen className="w-3.5 h-3.5" />
            <span>{L("Scanner un dossier (SST / TXT)")}</span>
            <input
              type="file"
              // @ts-ignore - webkitdirectory est standard sous Chromium/Safari
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFolderSelected}
              className="hidden"
            />
          </label>

          {/* Export JSON de la base */}
          <button
            type="button"
            onClick={handleExportJson}
            className="px-2.5 py-1.5 bg-[#262626] hover:bg-[#303030] text-[#38bdf8] border border-[#0ea5e9]/40 rounded flex items-center space-x-1.5 transition-colors"
            title={L("Exporter tout le dictionnaire local au format JSON")}
          >
            <Download className="w-3.5 h-3.5" />
            <span>{L("Sauvegarder dictionnaire JSON")}</span>
          </button>

          {/* Config auto-alimentation */}
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`px-2.5 py-1.5 rounded border flex items-center space-x-1.5 transition-colors ${
              showSettings ? 'bg-[#333333] text-white border-[#38bdf8]' : 'bg-[#262626] text-[#aaaaaa] hover:text-white border-[#333333]'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>{L("Règles d'auto-alimentation")}</span>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          {stats.userLearnedEntries > 0 && (
            <button
              type="button"
              onClick={handleClearLearned}
              className="px-2.5 py-1.5 bg-[#1e1e1e] hover:bg-[#2c2c2c] text-[#f87171] border border-[#ef4444]/40 rounded flex items-center space-x-1 transition-colors"
              title={L("Vider les données apprises")}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{L("Purger base locale")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Message de scan de dossier */}
      {folderScanStatus && (
        <div className="p-3 bg-[#222222] border border-[#22c55e] rounded-lg text-[13px] text-[#86efac] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" />
            <span>{folderScanStatus}</span>
          </div>
          <button
            type="button"
            onClick={() => setFolderScanStatus(null)}
            className="text-[#aaaaaa] hover:text-white ml-2 text-xs"
          >
            ×
          </button>
        </div>
      )}

      {/* Panneau rétractable des règles d'auto-alimentation */}
      {showSettings && (
        <div className="bg-[#181818] border border-[#333333] p-3.5 rounded-lg space-y-3 animate-in fade-in duration-150">
          <div className="font-semibold text-white text-xs flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span>{L("Règles d'alimentation automatique & scan prioritaire")}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <label className="flex items-start space-x-2 cursor-pointer bg-[#222222] p-2.5 rounded border border-[#2e2e2e]">
              <input
                type="checkbox"
                checked={settings.priorityScanLocalFirst}
                onChange={() => handleToggleSetting('priorityScanLocalFirst')}
                className="mt-0.5 accent-[#0ea5e9] w-4 h-4 rounded cursor-pointer"
              />
              <div>
                <div className="font-medium text-white text-[13px]">{L("Scanner le dictionnaire local en premier")}</div>
                <div className="text-[12px] text-[#aaaaaa]">{L("Priorité absolue à vos traductions locales sauvegardées sur les lexiques Bethesda généraux.")}</div>
              </div>
            </label>

            <label className="flex items-start space-x-2 cursor-pointer bg-[#222222] p-2.5 rounded border border-[#2e2e2e]">
              <input
                type="checkbox"
                checked={settings.autoLearnOnSave}
                onChange={() => handleToggleSetting('autoLearnOnSave')}
                className="mt-0.5 accent-[#0ea5e9] w-4 h-4 rounded cursor-pointer"
              />
              <div>
                <div className="font-medium text-white text-[13px]">{L("Auto-apprendre lors de la sauvegarde de plugin")}</div>
                <div className="text-[12px] text-[#aaaaaa]">{L("Alimente automatiquement la base avec toutes les chaînes traduites lors de chaque export ou sauvegarde d'ESP/ESM.")}</div>
              </div>
            </label>

            <label className="flex items-start space-x-2 cursor-pointer bg-[#222222] p-2.5 rounded border border-[#2e2e2e]">
              <input
                type="checkbox"
                checked={settings.autoLearnOnExportSST}
                onChange={() => handleToggleSetting('autoLearnOnExportSST')}
                className="mt-0.5 accent-[#0ea5e9] w-4 h-4 rounded cursor-pointer"
              />
              <div>
                <div className="font-medium text-white text-[13px]">{L("Auto-apprendre lors des exports SST / TXT")}</div>
                <div className="text-[12px] text-[#aaaaaa]">{L("Intègre systématiquement le dictionnaire exporté à votre base locale permanente.")}</div>
              </div>
            </label>

            <label className="flex items-start space-x-2 cursor-pointer bg-[#222222] p-2.5 rounded border border-[#2e2e2e]">
              <input
                type="checkbox"
                checked={settings.autoLearnOnValidate}
                onChange={() => handleToggleSetting('autoLearnOnValidate')}
                className="mt-0.5 accent-[#0ea5e9] w-4 h-4 rounded cursor-pointer"
              />
              <div>
                <div className="font-medium text-white text-[13px]">{L("Auto-apprendre à chaque validation de ligne (F10)")}</div>
                <div className="text-[12px] text-[#aaaaaa]">{L("Enregistre instantanément la traduction saisie dès qu'elle est validée.")}</div>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Recherche & liste des entrées locales */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-[#aaaaaa] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={L("Rechercher une entrée auto-apprise dans la base locale...")}
              className="w-full bg-[#181818] border border-[#2e2e2e] rounded pl-8 pr-3 py-1.5 text-white text-xs focus:border-[#38bdf8] focus:outline-none"
            />
          </div>
          <span className="text-[13px] text-[#aaaaaa] shrink-0">
            {filteredEntries.length} {L("entrée(s) trouvée(s)")}</span>
        </div>

        {/* Tableau des entrées locales */}
        <div className="bg-[#181818] border border-[#2e2e2e] rounded-lg overflow-hidden max-h-[360px] overflow-y-auto">
          {filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-[#666666]">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <div className="text-xs text-[#aaaaaa]">{L("Aucune entrée apprise trouvée.")}</div>
              <p className="text-[13px] text-[#666666] mt-1">{L("La base s'alimentera automatiquement au fil de vos traductions validées, de vos sauvegardes de plugins ou en scannant un dossier de fichiers SST.")}</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#1a1a1a] text-[#aaaaaa] border-b border-[#2e2e2e] sticky top-0 z-10 text-[12.5px]">
                <tr>
                  <th className="p-2.5 font-medium">{L("Texte VO (Source)")}</th>
                  <th className="p-2.5 font-medium">{L("Traduction VF Locale")}</th>
                  <th className="p-2.5 font-medium w-28">{L("Origine")}</th>
                  <th className="p-2.5 font-medium w-12 text-center">{L("Action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2e2e2e]">
                {filteredEntries.slice(0, 150).map((entry, idx) => (
                  <tr key={idx} className="hover:bg-[#1e1e1e] transition-colors">
                    <td className="p-2.5 font-mono text-[#dddddd] text-[13px] max-w-[280px] truncate" title={entry.source}>
                      {entry.source}
                    </td>
                    <td className="p-2.5 text-[#86efac] text-[13px] max-w-[280px] truncate" title={entry.target}>
                      {entry.target}
                    </td>
                    <td className="p-2.5 text-[12px] text-[#aaaaaa]">
                      <span className="px-1.5 py-0.5 rounded bg-[#262626] text-[#38bdf8] border border-[#0ea5e9]/30">
                        {entry.origin === 'save_plugin' ? 'Sauvegarde' : entry.origin === 'sst_import' ? 'Scan SST' : entry.origin === 'validation' ? 'Validation' : 'Auto'}
                      </span>
                    </td>
                    <td className="p-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteEntry(entry.source)}
                        className="text-[#666666] hover:text-[#f87171] p-1 rounded transition-colors"
                        title={L("Supprimer cette entrée")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
