/**
 * mTRANSLATOR macOS Edition
 * Application macOS épurée et moderne pour la traduction de mods Bethesda
 * Style Flat Fusion Dossier / FOMOD Simulator avec ascenseurs personnalisés et intégration Gemini.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ModRecord, 
  ModFileMeta, 
  FilterOptions, 
  DictionaryEntry, 
  GameEngine,
  RecordStatus
} from './types';
import { SAMPLE_SKYRIM_MOD, SAMPLE_FALLOUT_MOD, SAMPLE_STARFIELD_MOD } from './data/sampleMods';
import { VANILLA_DICTIONARY } from './data/vanillaDictionaries';
import { 
  calculateStats, 
  validateTags, 
  calculateSimilarity,
  exportToSST, 
  exportToTranslationTxt, 
  exportToCSV, 
  triggerFileDownload,
  sanitizeBethesdaTranslation
} from './utils/translatorUtils';
import { localDictStore } from './utils/localDictionaryStore';
import { parseModFile } from './utils/bethesdaBinaryParser';
import { xt, xtcoreAvailable, pickFile, getXtDict, ldScore, type XtExtract } from './utils/xtcore';
import { translateFallbackText } from './data/dictionaryHeuristics';
import { MacTitleBar } from './components/MacTitleBar';
import { Toolbar } from './components/Toolbar';
import { StringTable } from './components/StringTable';
import { TranslationEditor } from './components/TranslationEditor';
import { DictionaryModal } from './components/DictionaryModal';
import { AiBatchTranslateModal } from './components/AiBatchTranslateModal';
import { FindReplaceModal } from './components/FindReplaceModal';
import { StatsModal } from './components/StatsModal';
import { DiffModal } from './components/DiffModal';
import { BatchFilesModal } from './components/BatchFilesModal';
import { MacAppModal } from './components/MacAppModal';
import { SavePluginModal } from './components/SavePluginModal';
import { CodexWelcomeScreen } from './components/CodexWelcomeScreen';
import { AboutModal } from './components/AboutModal';
import { Check, Info } from 'lucide-react';
import { useI18n } from './i18n/LanguageContext';

export default function App() {
  const { t, targetLang, targetLocale, sourceLang } = useI18n();
  // État du chargement d'un fichier (faux au lancement = écran d'accueil Codex)
  const [isFileLoaded, setIsFileLoaded] = useState(false);

  // Buffer binaire d'origine (utilisé pour la reconstruction chirurgicale et le backup)
  const [originalBuffer, setOriginalBuffer] = useState<ArrayBuffer | null>(null);
  // Handle vers le fichier sur le disque local (API File System Access) pour écrasement direct in-place
  const [fileHandle, setFileHandle] = useState<any>(null);

  // État du mod et métadonnées
  const [meta, setMeta] = useState<ModFileMeta>(SAMPLE_SKYRIM_MOD.meta);
  const [records, setRecords] = useState<ModRecord[]>(SAMPLE_SKYRIM_MOD.records);
  const [selectedId, setSelectedId] = useState<string | null>(SAMPLE_SKYRIM_MOD.records[0]?.id || null);

  // Dictionnaires SST et mémoires de traduction avec persistance et priorité locale
  const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>(() => {
    return localDictStore.getUnifiedDictionary();
  });

  // Abonnement aux modifications de la base de données locale auto-alimentée
  useEffect(() => {
    const unsub = localDictStore.subscribe(() => {
      setDictionaries(localDictStore.getUnifiedDictionary());
    });
    return unsub;
  }, []);

  // Tri de la table
  const [sortBy, setSortBy] = useState<'formId' | 'recordType' | 'status' | 'source'>('formId');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Filtres
  const [filter, setFilter] = useState<FilterOptions>({
    status: 'all',
    recordType: 'all',
    searchQuery: '',
    searchField: 'all',
    caseSensitive: false,
    useRegex: false,
    onlyWarnings: false,
  });

  // Modales
  const [isDictionaryModalOpen, setIsDictionaryModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isFindReplaceModalOpen, setIsFindReplaceModalOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [isMacAppModalOpen, setIsMacAppModalOpen] = useState(false);
  const [isSavePluginModalOpen, setIsSavePluginModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  // Notification Toast épurée
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<{ percent: number; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cœur Rust xtcore (app macOS) : plugin ouvert par son chemin, repli sur les parseurs TS sinon
  const [xtReady, setXtReady] = useState(false);
  const [pluginPath, setPluginPath] = useState<string | null>(null);
  // Texte MCM ou autre texte ouvert par xtcore (null : plugin) et nom de sortie proposé
  const [txtDoc, setTxtDoc] = useState<{ kind: string; outputName: string } | null>(null);
  useEffect(() => {
    xtcoreAvailable().then(setXtReady);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Liste des types de records uniques présents dans le projet
  const recordTypes = useMemo(() => {
    const types = new Set<string>();
    records.forEach((r) => {
      if (r.recordType) types.add(r.recordType);
    });
    return Array.from(types).sort();
  }, [records]);

  // Calcul des statistiques
  const stats = useMemo(
    () => calculateStats(filter.showScripts ? records : records.filter((r) => !r.locked)),
    [records, filter.showScripts]
  );
  const scriptCount = useMemo(() => records.filter((r) => r.locked).length, [records]);

  // Nombre de modifications non enregistrées
  const modifiedCount = useMemo(() => {
    return records.filter((r) => r.modified).length;
  }, [records]);

  // Enregistrement actif sélectionné
  const selectedRecord = useMemo(() => {
    return records.find((r) => r.id === selectedId) || null;
  }, [records, selectedId]);

  // Filtrage et tri des enregistrements pour l'affichage
  const displayedRecords = useMemo(() => {
    return records
      .filter((r) => {
        // Chaînes de scripts (VMAD) : verrouillées tant que l'option n'est pas active
        if (r.locked && !filter.showScripts) return false;

        // Filtre par statut
        if (filter.onlyWarnings) {
          if (!r.tagWarnings || r.tagWarnings.length === 0) return false;
        } else if (filter.status !== 'all' && r.status !== filter.status) {
          return false;
        }

        // Filtre par type
        if (filter.recordType !== 'all' && r.recordType !== filter.recordType) {
          return false;
        }

        // Filtre de recherche
        if (filter.searchQuery.trim()) {
          const q = filter.searchQuery.toLowerCase();
          if (filter.searchField === 'source') {
            return r.source.toLowerCase().includes(q);
          }
          if (filter.searchField === 'target') {
            return r.target.toLowerCase().includes(q);
          }
          if (filter.searchField === 'formId') {
            return r.formId.toLowerCase().includes(q);
          }
          if (filter.searchField === 'edid') {
            return r.edid.toLowerCase().includes(q);
          }
          // 'all'
          return (
            r.source.toLowerCase().includes(q) ||
            r.target.toLowerCase().includes(q) ||
            r.formId.toLowerCase().includes(q) ||
            r.edid.toLowerCase().includes(q)
          );
        }

        return true;
      })
      .sort((a, b) => {
        let valA = a[sortBy] || '';
        let valB = b[sortBy] || '';
        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
  }, [records, filter, sortBy, sortDirection]);

  // Gestion du tri par colonne
  const handleSort = (column: 'formId' | 'recordType' | 'status' | 'source') => {
    if (sortBy === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDirection('asc');
    }
  };

  // Mise à jour de la traduction d'une ligne
  const handleUpdateTarget = (recordId: string, newTarget: string, autoValidate: boolean = false) => {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id !== recordId) return r;

        const tagWarnings = validateTags(r.source, newTarget);
        let newStatus: RecordStatus = r.status;

        if (autoValidate || (newTarget.trim() && tagWarnings.length === 0)) {
          newStatus = 'translated';
        } else if (newTarget.trim()) {
          newStatus = 'partial';
        } else {
          newStatus = 'untranslated';
        }

        return {
          ...r,
          target: newTarget,
          status: newStatus,
          modified: true,
          validated: autoValidate,
          tagWarnings,
        };
      })
    );
  };

  // Validation d'une chaîne (Statut Vert)
  const handleValidate = (recordId: string) => {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id !== recordId) return r;
        const warnings = validateTags(r.source, r.target);
        // Auto-apprentissage immédiat dans le dictionnaire local
        if (localDictStore.getSettings().autoLearnOnValidate && r.target && r.target.trim()) {
          localDictStore.learnSingle(r.source, r.target, meta.game, 'validation', r.recordType ? `${r.recordType} (${r.edid || r.formId})` : undefined);
        }
        return {
          ...r,
          status: 'translated',
          validated: true,
          modified: true,
          tagWarnings: warnings,
        };
      })
    );
    showToast('Enregistrement validé (mémorisé dans le dictionnaire local).');
  };

  // Marquer identique à l'original (Statut Bleu)
  const handleMarkIdentical = (recordId: string) => {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id !== recordId) return r;
        return {
          ...r,
          target: r.source,
          status: 'identical',
          validated: true,
          modified: true,
          tagWarnings: [],
        };
      })
    );
    showToast('Marqué comme identique à l\'original (nom propre/lore).');
  };

  // Sauter à la prochaine chaîne non traduite
  const handleNextUntranslated = () => {
    const currentIndex = displayedRecords.findIndex((r) => r.id === selectedId);
    // Recherche à partir de l'index courant + 1
    const nextUntranslated = displayedRecords.slice(currentIndex + 1).find((r) => r.status === 'untranslated')
      || displayedRecords.find((r) => r.status === 'untranslated');

    if (nextUntranslated) {
      setSelectedId(nextUntranslated.id);
    } else {
      showToast('Toutes les chaînes affichées sont traduites !');
    }
  };

  // Navigation simple Haut / Bas
  const handlePrevRecord = () => {
    const currentIndex = displayedRecords.findIndex((r) => r.id === selectedId);
    if (currentIndex > 0) {
      setSelectedId(displayedRecords[currentIndex - 1].id);
    }
  };

  const handleNextRecord = () => {
    const currentIndex = displayedRecords.findIndex((r) => r.id === selectedId);
    if (currentIndex < displayedRecords.length - 1 && currentIndex >= 0) {
      setSelectedId(displayedRecords[currentIndex + 1].id);
    }
  };

  // Raccourcis clavier globaux (macOS)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘S ou Ctrl+S : Sauvegarder
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // ⌘O ou Ctrl+O : Ouvrir un fichier
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        handleOpenFile();
      }
      // F10 : Valider et Suivant
      if (e.key === 'F10') {
        e.preventDefault();
        if (selectedId) {
          handleValidate(selectedId);
          handleNextUntranslated();
        }
      }
      // Flèche Haut / Bas si aucune zone de texte active
      if (e.target instanceof HTMLElement && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          handlePrevRecord();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          handleNextRecord();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, displayedRecords]);

  // Pont vers les menus macOS natifs (python_app/mtranslator_app.py appelle window.mtranslatorMenu)
  const menuActions = useRef<Record<string, () => void>>({});
  menuActions.current = {
    open: () => handleOpenFile(),
    save: () => isFileLoaded && handleSave(),
    close: () => isFileLoaded && handleCloseFile(),
    undo: () => isFileLoaded && handleUndo(),
    exportSST: () => isFileLoaded && handleExport('SST'),
    exportTXT: () => isFileLoaded && handleExport('TXT'),
    exportCSV: () => isFileLoaded && handleExport('CSV'),
    exportJSON: () => isFileLoaded && handleExport('JSON'),
    exportESP: () => isFileLoaded && handleExport('ESP'),
    batch: () => setIsBatchModalOpen(true),
    translate: () => isFileLoaded && setIsAiModalOpen(true),
    findReplace: () => isFileLoaded && setIsFindReplaceModalOpen(true),
    validateNext: () => {
      if (selectedId) {
        handleValidate(selectedId);
        handleNextUntranslated();
      }
    },
    dictionaries: () => setIsDictionaryModalOpen(true),
    stats: () => isFileLoaded && setIsStatsModalOpen(true),
    diff: () => isFileLoaded && setIsDiffModalOpen(true),
    about: () => setIsAboutModalOpen(true),
  };
  useEffect(() => {
    (window as unknown as { mtranslatorMenu?: (a: string) => void }).mtranslatorMenu = (action: string) =>
      menuActions.current[action]?.();
    // Pas de menu contextuel de navigateur (« Recharger »…) hors des champs de saisie
    const noBrowserMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('input, textarea, [contenteditable="true"]') && !window.getSelection()?.toString()) {
        e.preventDefault();
      }
    };
    window.addEventListener('contextmenu', noBrowserMenu);
    return () => {
      window.removeEventListener('contextmenu', noBrowserMenu);
      delete (window as unknown as { mtranslatorMenu?: unknown }).mtranslatorMenu;
    };
  }, []);

  // Sauvegarder : persistance locale + ouverture de la sauvegarde binaire du plugin avec backup horodaté
  const handleSave = () => {
    if (pluginPath && xtReady) {
      void savePluginWithXt();
      return;
    }
    setRecords((prev) =>
      prev.map((r) => ({
        ...r,
        modified: false,
      }))
    );
    try {
      localStorage.setItem(`mtranslator_mod_${meta.fileName}`, JSON.stringify({ meta, records }));
    } catch {
      // Ignore les limites de stockage si dataset volumineux
    }
    // Ouverture de la fenêtre de sauvegarde du plugin ESP/ESM avec backup horodaté
    setIsSavePluginModalOpen(true);
  };

  // Enregistrement par xtcore : plugin traduit écrit à l'emplacement choisi (copie .bak si écrasé)
  const savePluginWithXt = async () => {
    if (!pluginPath) return;
    const dir = pluginPath.slice(0, pluginPath.lastIndexOf('/'));
    const out = await pickFile({
      mode: 'save',
      title: txtDoc ? 'Enregistrer le texte traduit' : 'Enregistrer le plugin traduit',
      defaultName: txtDoc ? txtDoc.outputName : meta.fileName,
      directory: dir,
    }).catch(
      (err) => {
        showToast(`Sélecteur natif indisponible : ${err.message}`);
        return null;
      }
    );
    if (!out) return;
    const rows = records
      .filter((r) => r.xtId !== undefined && r.target.trim() && r.target !== r.source)
      .map((r) => ({ id: r.xtId as number, dest: r.target }));
    setLoadingProgress({ percent: 50, message: `Écriture de ${out.split('/').pop()}…` });
    try {
      const res = txtDoc ? await xt.txtWrite(pluginPath, out, rows) : await xt.write(pluginPath, out, rows);
      setRecords((prev) => prev.map((r) => ({ ...r, modified: false })));
      setMeta((prev) => ({ ...prev, lastSaved: new Date().toLocaleString() }));
      showToast(`${res.written_count.toLocaleString()} traduction(s) écrite(s) dans ${out.split('/').pop()}${res.backup ? ' (ancienne version en .bak)' : ''}.`);
    } catch (err: any) {
      showToast(`Enregistrement impossible : ${err.message}`);
    } finally {
      setLoadingProgress(null);
    }
  };

  // Chargement d'un des projets d'exemples Bethesda
  const handleOpenSample = (key: 'skyrim' | 'fallout' | 'starfield') => {
    let sample = SAMPLE_SKYRIM_MOD;
    if (key === 'fallout') sample = SAMPLE_FALLOUT_MOD;
    if (key === 'starfield') sample = SAMPLE_STARFIELD_MOD;

    setFileHandle(null);
    setOriginalBuffer(null);
    setPluginPath(null);
    setTxtDoc(null);
    setMeta(sample.meta);
    setRecords(sample.records);
    setSelectedId(sample.records[0]?.id || null);
    setIsFileLoaded(true);
    showToast(`Projet d'exemple chargé : ${sample.meta.fileName} (${sample.meta.game})`);
  };

  // Fermer le fichier actif pour revenir à l'accueil Codex
  const handleCloseFile = () => {
    setFileHandle(null);
    setPluginPath(null);
    setTxtDoc(null);
    setOriginalBuffer(null);
    setIsFileLoaded(false);
    showToast("Fermeture du projet. Prêt pour un nouveau fichier.");
  };

  // Annuler la modification sur la chaîne courante
  const handleUndo = () => {
    if (selectedId) {
      setRecords((prev) =>
        prev.map((r) => {
          if (r.id === selectedId) {
            return {
              ...r,
              target: r.source,
              status: 'untranslated',
              modified: false,
              validated: false,
              tagWarnings: [],
            };
          }
          return r;
        })
      );
      showToast('Ligne réinitialisée au texte original VO.');
    } else {
      showToast('Sélectionnez une ligne pour annuler.');
    }
  };

  // Export de fichiers
  const handleExport = (format: 'SST' | 'TXT' | 'CSV' | 'JSON' | 'ESP') => {
    const baseName = meta.fileName.replace(/\.[^/.]+$/, '');

    if (format === 'ESP') {
      if (pluginPath && xtReady) void savePluginWithXt();
      else setIsSavePluginModalOpen(true);
    } else if (format === 'SST') {
      const xml = exportToSST(records, meta.game, sourceLang, targetLang);
      triggerFileDownload(xml, `${baseName}_${targetLocale.toUpperCase()}.sst`, 'application/xml;charset=utf-8');
      if (localDictStore.getSettings().autoLearnOnExportSST) {
        const learned = localDictStore.learnFromRecords(records, meta.game, 'sst_export');
        showToast(`Export SST (${targetLang}) terminé (${records.length} entrées). +${learned} ajoutées à la base locale.`);
      } else {
        showToast(`Export du dictionnaire SST (${targetLang}) terminé (${records.length} entrées).`);
      }
    } else if (format === 'TXT') {
      const txt = exportToTranslationTxt(records);
      triggerFileDownload(txt, `${baseName}_${targetLocale.toUpperCase()}.txt`, 'text/plain;charset=utf-8');
      if (localDictStore.getSettings().autoLearnOnExportSST) {
        localDictStore.learnFromRecords(records, meta.game, 'txt_import');
      }
      showToast('Export du fichier de traduction TXT Bethesda terminé (intégré au dictionnaire local).');
    } else if (format === 'CSV') {
      const csv = exportToCSV(records);
      triggerFileDownload(csv, `${baseName}_export.csv`, 'text/csv;charset=utf-8');
      showToast('Export CSV terminé.');
    } else if (format === 'JSON') {
      const jsonStr = JSON.stringify({ meta, records }, null, 2);
      triggerFileDownload(jsonStr, `${baseName}_project.json`, 'application/json;charset=utf-8');
      showToast('Export du projet JSON terminé.');
    }
  };

  // Application des dictionnaires SST (100% ou fuzzy)
  // OPTIMISATION HAUT DÉBIT O(1) : Utilise une Map instantanée au lieu d'une recherche linéaire O(N*M)
  // pour éliminer tout freeze lors de l'application de centaines ou milliers de traductions.
  const handleApplyDictionary = (matchType: 'exact' | 'fuzzy') => {
    if (pluginPath && xtReady) return applyDictionaryXt(matchType);
    let appliedCount = 0;

    if (matchType === 'exact') {
      // 1. Construction d'une Map O(1) instantanée unifiée
      const exactLookup = new Map<string, string>();

      // A. Dictionnaires SST et vanilla en mémoire
      for (let i = 0; i < dictionaries.length; i++) {
        const d = dictionaries[i];
        if (d.source && d.target) {
          const k = d.source.trim().toLowerCase();
          if (!exactLookup.has(k)) {
            exactLookup.set(k, d.target);
          }
        }
      }

      // B. Dictionnaire local auto-alimenté (Prioritaire : écrase les entrées)
      const learned = localDictStore.getLearnedEntries();
      for (let i = 0; i < learned.length; i++) {
        const l = learned[i];
        if (l.source && l.target) {
          exactLookup.set(l.source.trim().toLowerCase(), l.target);
        }
      }

      // 2. Application O(1) directe sur les enregistrements non traduits
      setRecords((prev) =>
        prev.map((rec) => {
          if (rec.status === 'translated') return rec;

          const key = rec.source.trim().toLowerCase();
          const target = exactLookup.get(key);

          if (target) {
            appliedCount++;
            const sanitized = sanitizeBethesdaTranslation(target, rec.source);
            const warnings = validateTags(rec.source, sanitized);
            return {
              ...rec,
              target: sanitized,
              status: warnings.length === 0 ? 'translated' : 'partial',
              modified: true,
              validated: warnings.length === 0,
              tagWarnings: warnings,
              fuzzyMatch: 100,
              dictionaryMatch: sanitized,
            };
          }

          return rec;
        })
      );

      if (appliedCount > 0) {
        showToast(`${appliedCount.toLocaleString()} traduction(s) SST (100% exactes) appliquée(s) instantanément.`);
      } else {
        showToast('Aucune nouvelle correspondance exacte SST trouvée.');
      }

      return { appliedCount };
    } else {
      // Correspondances partielles (Fuzzy Match > 75%)
      // Partitionnement par tranche de longueur pour éliminer l'explosion combinatoire
      const lengthBuckets = new Map<number, DictionaryEntry[]>();
      for (let i = 0; i < dictionaries.length; i++) {
        const d = dictionaries[i];
        if (!d.source || !d.target) continue;
        const bucket = Math.floor(d.source.length / 5);
        let list = lengthBuckets.get(bucket);
        if (!list) {
          list = [];
          lengthBuckets.set(bucket, list);
        }
        if (list.length < 40) {
          list.push(d);
        }
      }

      setRecords((prev) =>
        prev.map((rec) => {
          if (rec.status === 'translated' || (rec.target && rec.target.trim().length > 0)) return rec;

          const cleanSrc = rec.source.trim();
          if (cleanSrc.length < 3 || cleanSrc.length > 140) return rec;

          const bucket = Math.floor(cleanSrc.length / 5);
          const candidates: DictionaryEntry[] = [
            ...(lengthBuckets.get(bucket) || []),
            ...(lengthBuckets.get(bucket - 1) || []),
            ...(lengthBuckets.get(bucket + 1) || []),
          ];

          let bestScore = 0;
          let bestEntry: DictionaryEntry | undefined;

          for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            const s = calculateSimilarity(c.source, cleanSrc);
            if (s > bestScore && s >= 75) {
              bestScore = s;
              bestEntry = c;
              if (s >= 95) break;
            }
          }

          if (bestEntry && bestScore >= 75) {
            appliedCount++;
            const sanitized = sanitizeBethesdaTranslation(bestEntry.target, rec.source);
            const warnings = validateTags(rec.source, sanitized);
            return {
              ...rec,
              target: sanitized,
              status: warnings.length === 0 ? 'translated' : 'partial',
              modified: true,
              validated: false,
              tagWarnings: warnings,
              fuzzyMatch: bestScore,
              dictionaryMatch: sanitized,
            };
          }

          return rec;
        })
      );

      if (appliedCount > 0) {
        showToast(`${appliedCount.toLocaleString()} suggestion(s) floue(s) (>75%) appliquée(s).`);
      } else {
        showToast('Aucune correspondance floue supérieure à 75% trouvée.');
      }

      return { appliedCount };
    }
  };

  // Traduction automatique par xtcore : dictionnaire = dossier de SST de xTranslator
  const applyDictionaryXt = async (matchType: 'exact' | 'fuzzy') => {
    if (!pluginPath) return { appliedCount: 0 };
    const dict = getXtDict();
    setLoadingProgress({ percent: 30, message: `Recherche dans les dictionnaires SST (${dict.split('/').pop()})…` });
    try {
      const res = txtDoc
        ? await xt.txtTranslate(pluginPath, dict).then((t) => ({
            ...t,
            exact: t.results.filter((r) => r.kind === 'exact').length,
            heuristic: t.results.filter((r) => r.kind === 'heuristic').length,
            search_ms: 0,
            written: null,
          }))
        : await xt.translate(pluginPath, dict, { vmad: filter.showScripts });
      const byId = new Map(res.results.filter((r) => matchType === 'fuzzy' || r.kind === 'exact').map((r) => [r.id, r]));
      let appliedCount = 0;
      setRecords((prev) =>
        prev.map((rec) => {
          const hit = rec.xtId !== undefined ? byId.get(rec.xtId) : undefined;
          if (!hit || rec.status === 'translated' || rec.validated) return rec;
          appliedCount++;
          const exact = hit.kind === 'exact';
          const warnings = validateTags(rec.source, hit.dest);
          return {
            ...rec,
            target: hit.dest,
            status: exact && warnings.length === 0 ? 'translated' : 'partial',
            modified: true,
            validated: exact && warnings.length === 0,
            tagWarnings: warnings,
            fuzzyMatch: exact ? 100 : ldScore(hit.ld ?? 1),
            dictionaryMatch: hit.dest,
          };
        })
      );
      showToast(
        `xtcore : ${res.exact.toLocaleString()} exacte(s), ${res.heuristic.toLocaleString()} approchante(s) sur ${res.strings.toLocaleString()} chaînes (${res.search_ms} ms).`
      );
      return { appliedCount: matchType === 'exact' ? res.exact : res.exact + res.heuristic };
    } catch (err: any) {
      showToast(`Traduction xtcore impossible : ${err.message}`);
      return { appliedCount: 0 };
    } finally {
      setLoadingProgress(null);
    }
  };

  // Recherche heuristique pour le panneau de suggestions (null hors app macOS)
  const searchSuggestions = pluginPath && xtReady
    ? (rec: ModRecord) => xt.search(getXtDict(), rec.source, 8, rec.recordType, rec.field)
    : undefined;

  // Importation d'un dictionnaire personnalisé (ou lot multi-fichiers)
  const handleImportDictionary = (entries: DictionaryEntry[], batchReport?: any) => {
    if (batchReport?.filesReport) {
      showToast(`${batchReport.filesReport.length} fichier(s) SST traité(s) : ${entries.length.toLocaleString()} entrées intégrées à votre base locale.`);
    } else {
      showToast(`${entries.length.toLocaleString()} entrées de dictionnaire ajoutées à la base locale.`);
    }
  };

  // Réinitialisation de la Database SST aux originaux Vanilla
  const handleResetDictionaries = () => {
    setDictionaries(VANILLA_DICTIONARY);
    try {
      localStorage.removeItem('mtranslator_custom_dictionaries');
      localStorage.removeItem('xtranslator_custom_dictionaries');
    } catch {}
    showToast('Base de données SST réinitialisée aux dictionnaires officiels Bethesda.');
  };

  // Application de la traduction IA par lot
  const handleApplyBatchTranslations = (translations: Array<{ id: string; translatedText: string }>) => {
    const transMap = new Map(translations.map((t) => [t.id, t.translatedText]));

    setRecords((prev) =>
      prev.map((rec) => {
        const rawTrans = transMap.get(rec.id);
        if (rawTrans !== undefined) {
          const trans = sanitizeBethesdaTranslation(rawTrans, rec.source);
          const warnings = validateTags(rec.source, trans);
          return {
            ...rec,
            target: trans,
            status: warnings.length === 0 ? 'translated' : 'partial',
            modified: true,
            validated: warnings.length === 0,
            tagWarnings: warnings,
          };
        }
        return rec;
      })
    );

    showToast(`${translations.length} chaînes traduites par Gemini intégrées.`);
  };

  // Traduction d'une ligne individuelle via IA
  const handleTranslateSingleWithAi = async (record: ModRecord): Promise<string | null> => {
    try {
      const response = await fetch('/api/translate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: record.id, text: record.source }],
          gameContext: meta.game,
          targetLang: 'Français',
        }),
      });

      if (!response.ok) {
        // En cas d'erreur 401 ou indisponibilité API, traduction par heuristique locale
        const found = dictionaries.find(
          (d) => d.source.toLowerCase() === record.source.toLowerCase()
        );
        if (found) {
          showToast('Traduction issue du glossaire SST local.');
          return sanitizeBethesdaTranslation(found.target, record.source);
        }
        showToast('Traduction automatique locale (Mode Secours).');
        return sanitizeBethesdaTranslation(translateFallbackText(record.source), record.source);
      }

      const data = await response.json();
      if (data.translations && data.translations[0]) {
        if (data.warning) {
          showToast('Traduction générée via le glossaire de secours.');
        }
        return sanitizeBethesdaTranslation(data.translations[0].translatedText, record.source);
      }
      return sanitizeBethesdaTranslation(translateFallbackText(record.source), record.source);
    } catch {
      // Fallback gracieux sur le dictionnaire et l'heuristique
      const found = dictionaries.find(
        (d) => d.source.toLowerCase() === record.source.toLowerCase()
      );
      if (found) {
        showToast('Traduction issue du glossaire SST local.');
        return sanitizeBethesdaTranslation(found.target, record.source);
      }
      showToast('Traduction automatique locale (Mode Secours).');
      return sanitizeBethesdaTranslation(translateFallbackText(record.source), record.source);
    }
  };

  // Remplacement par lot (Find & Replace)
  const handleBatchReplace = (
    findText: string,
    replaceText: string,
    options: {
      targetField: 'target' | 'source';
      useRegex: boolean;
      caseSensitive: boolean;
    }
  ) => {
    let replacedCount = 0;
    const flags = options.caseSensitive ? 'g' : 'gi';
    let regex: RegExp;

    if (options.useRegex) {
      regex = new RegExp(findText, flags);
    } else {
      const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, flags);
    }

    setRecords((prev) =>
      prev.map((rec) => {
        const textToSearch = options.targetField === 'target' ? rec.target : rec.source;
        if (regex.test(textToSearch)) {
          replacedCount++;
          const newText = textToSearch.replace(regex, replaceText);

          if (options.targetField === 'target') {
            const warnings = validateTags(rec.source, newText);
            return {
              ...rec,
              target: newText,
              modified: true,
              tagWarnings: warnings,
            };
          } else {
            return {
              ...rec,
              source: newText,
              modified: true,
            };
          }
        }
        return rec;
      })
    );

    return { replacedCount };
  };

  // Fusion de nouvelles lignes depuis le Diff
  const handleMergeNewRecords = (newRecords: ModRecord[]) => {
    setRecords((prev) => [...prev, ...newRecords]);
    showToast(`${newRecords.length} nouvelles chaînes injectées depuis la révision.`);
  };

  // Traitement et chargement unifié d'un fichier mod ou traduction
  const handleProcessFile = async (file: File, handle?: any) => {
    try {
      setLoadingProgress({ percent: 5, message: `Ouverture de ${file.name}...` });
      showToast(`Chargement de ${file.name}...`);
      const buffer = await file.arrayBuffer();
      setOriginalBuffer(buffer);
      setPluginPath(null);
      setTxtDoc(null);
      if (handle !== undefined) {
        setFileHandle(handle);
      }
      const result = await parseModFile(file, meta.game, (percent, message) => {
        setLoadingProgress({ percent, message });
      });

      if (result.records && result.records.length > 0) {
        setMeta((prev) => ({
          ...prev,
          ...result.meta,
          fileName: file.name,
        }));
        setRecords(result.records);
        setSelectedId(result.records[0].id);
        setIsFileLoaded(true);
        showToast(`${result.records.length.toLocaleString()} enregistrements extraits depuis ${file.name}`);
      } else {
        showToast('Aucun texte ou chaîne traduisible trouvée dans ce fichier.');
      }
    } catch (err: any) {
      console.error('Erreur chargement fichier:', err);
      showToast(`Erreur de lecture du fichier : ${err.message || 'Format invalide'}`);
    } finally {
      setLoadingProgress(null);
    }
  };

  // Ouverture d'un plugin par le cœur xtcore (chemin donné par le sélecteur natif)
  const GAME_NAMES: Record<XtExtract['game'], GameEngine> = {
    Skyrim: 'Skyrim Legendary Edition',
    SkyrimSE: 'Skyrim Special Edition',
    Fallout4: 'Fallout 4',
    Starfield: 'Starfield',
  };
  const openPluginWithXt = async (path: string) => {
    const fileName = path.split('/').pop() || path;
    setLoadingProgress({ percent: 20, message: `Extraction de ${fileName} (xtcore)…` });
    try {
      const res = await xt.extract(path);
      const recs: ModRecord[] = res.strings.map((s) => ({
        id: `xt-${s.id}`,
        xtId: s.id,
        formId: s.form_id.toString(16).toUpperCase().padStart(8, '0'),
        edid: s.edid,
        recordType: s.rec,
        field: s.field,
        source: s.text,
        target: '',
        status: 'untranslated',
        modified: false,
        validated: false,
        ...(s.vmad ? { locked: true, notes: `Script ${s.vmad.script} · propriété ${s.vmad.prop}` } : {}),
      }));
      if (recs.length === 0) {
        showToast('Aucune chaîne traduisible trouvée dans ce plugin.');
        return;
      }
      const ext = (fileName.split('.').pop() || 'esp').toUpperCase() as ModFileMeta['fileType'];
      setFileHandle(null);
      setOriginalBuffer(null);
      setPluginPath(path);
      setMeta((prev) => ({ ...prev, fileName, fileType: ext, game: GAME_NAMES[res.game], encoding: 'UTF-8' }));
      const scripts = recs.filter((r) => r.locked).length;
      setTxtDoc(null);
      setRecords(recs);
      setSelectedId((recs.find((r) => !r.locked) ?? recs[0]).id);
      setIsFileLoaded(true);
      showToast(
        `${(recs.length - scripts).toLocaleString()} chaînes extraites de ${fileName} (${res.localized ? 'localisé, ' : ''}${res.game})` +
          (scripts ? `, ${scripts.toLocaleString()} chaîne(s) de scripts masquée(s) (filtre « Chaînes de scripts »).` : '.')
      );
    } catch (err: any) {
      showToast(`Lecture impossible : ${err.message}`);
    } finally {
      setLoadingProgress(null);
    }
  };

  // Ouverture d'un texte MCM (Interface/Translations/*.txt) ou d'un autre texte par xtcore
  const openTxtWithXt = async (path: string) => {
    const fileName = path.split('/').pop() || path;
    setLoadingProgress({ percent: 20, message: `Lecture de ${fileName} (xtcore)…` });
    try {
      const res = await xt.txt(path);
      const recType = res.kind.toUpperCase();
      const recs: ModRecord[] = res.strings.map((s) => ({
        id: `xt-${s.id}`,
        xtId: s.id,
        formId: (s.line + 1).toString().padStart(5, '0'),
        edid: s.key,
        recordType: recType,
        field: res.kind,
        source: s.text,
        target: '',
        status: 'untranslated',
        modified: false,
        validated: false,
      }));
      if (recs.length === 0) {
        showToast('Aucune chaîne traduisible trouvée dans ce fichier.');
        return;
      }
      setFileHandle(null);
      setOriginalBuffer(null);
      setPluginPath(path);
      setTxtDoc({ kind: res.kind, outputName: res.output_name });
      setMeta((prev) => ({ ...prev, fileName, fileType: 'TXT', encoding: 'UTF-8' }));
      setRecords(recs);
      setSelectedId(recs[0].id);
      setIsFileLoaded(true);
      showToast(`${recs.length.toLocaleString()} chaînes lues dans ${fileName} (type ${res.kind}, ${res.encoding}).`);
    } catch (err: any) {
      showToast(`Lecture impossible : ${err.message}`);
    } finally {
      setLoadingProgress(null);
    }
  };

  // Ouverture avec File System Access API natif (permet l'accès direct et l'écrasement in-place)
  const handleOpenFile = async () => {
    if (xtReady) {
      try {
        const path = await pickFile({
          mode: 'open',
          title: 'Ouvrir un plugin ou un texte MCM',
          directory: pluginPath ? pluginPath.slice(0, pluginPath.lastIndexOf('/')) : undefined,
          fileTypes: ['Plugins Bethesda (*.esp;*.esm;*.esl)', 'Textes MCM et autres (*.txt;*.ini;*.xml)', 'Tous les fichiers (*.*)'],
        });
        if (!path) return;
        if (/\.(esp|esm|esl)$/i.test(path)) {
          await openPluginWithXt(path);
          return;
        }
        if (/\.(txt|ini|xml|csv|json)$/i.test(path)) {
          await openTxtWithXt(path);
          return;
        }
        showToast('Autre format : choisissez-le à nouveau dans le sélecteur du navigateur.');
      } catch (err: any) {
        showToast(`Sélecteur natif indisponible : ${err.message}`);
      }
    }
    if (typeof window !== 'undefined' && 'showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: 'Plugins Bethesda et fichiers traduisibles',
              accept: {
                'application/octet-stream': ['.esp', '.esm', '.esl', '.strings', '.dlstrings', '.ilstrings'],
                'text/plain': ['.txt', '.sst', '.csv', '.json'],
              },
            },
          ],
          multiple: false,
        });
        if (handle) {
          const file = await handle.getFile();
          await handleProcessFile(file, handle);
          return;
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        // En cas d'erreur de permission ou contexte iframe restreint, fallback vers file input
      }
    }
    fileInputRef.current?.click();
  };

  // Chargement de fichier local standard (ESP / ESM / ESL / STRINGS / SST / TXT / CSV / JSON)
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleProcessFile(file, null);
    if (e.target) e.target.value = '';
  };

  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Gestion du glisser-déposer de fichiers mods (.esp, .strings, .txt, .sst)
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const dropFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openDroppedPath = useRef<(path: string) => void>(() => {});
  openDroppedPath.current = (path: string) => {
    if (dropFallback.current) {
      clearTimeout(dropFallback.current);
      dropFallback.current = null;
    }
    if (/\.(esp|esm|esl)$/i.test(path)) openPluginWithXt(path);
    else openTxtWithXt(path);
  };
  useEffect(() => {
    const w = window as unknown as { mtranslatorDropPath?: (p: string) => void };
    w.mtranslatorDropPath = (p: string) => openDroppedPath.current(p);
    return () => {
      delete w.mtranslatorDropPath;
    };
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    let handle: any = null;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const item = e.dataTransfer.items[0];
      if ('getAsFileSystemHandle' in item) {
        try {
          const h = await (item as any).getAsFileSystemHandle();
          if (h && h.kind === 'file') {
            handle = h;
          }
        } catch {
          // ignore
        }
      }
    }

    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    // Dans l'app, pywebview transmet le chemin complet (window.mtranslatorDropPath) : xtcore lit
    // alors le fichier sur le disque. Sans réponse, repli sur la lecture dans le navigateur.
    if (xtReady && /\.(esp|esm|esl|txt|ini|xml|csv|json)$/i.test(file.name)) {
      if (dropFallback.current) clearTimeout(dropFallback.current);
      dropFallback.current = setTimeout(() => {
        dropFallback.current = null;
        handleProcessFile(file, handle);
      }, 1500);
      return;
    }
    await handleProcessFile(file, handle);
  };

  return (
    <div 
      className="h-screen w-screen flex flex-col bg-[#181818] text-[#dddddd] overflow-hidden select-none relative font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Indicateur de chargement non-bloquant pour les gros fichiers */}
      {loadingProgress && (
        <div className="absolute inset-0 z-50 bg-[#181818]/85 backdrop-blur-sm flex flex-col items-center justify-center p-4">
          <div className="bg-[#1a1a1a] border border-[#333333] p-6 rounded-xl shadow-2xl flex flex-col items-center space-y-4 max-w-sm w-full animate-in fade-in zoom-in-95 duration-150">
            <div className="w-10 h-10 rounded-full border-2 border-[#38bdf8] border-t-transparent animate-spin" />
            <div className="text-center w-full">
              <h3 className="text-sm font-semibold text-white mb-1">Importation en cours</h3>
              <p className="text-xs text-[#aaaaaa] truncate">{loadingProgress.message}</p>
            </div>
            <div className="w-full bg-[#181818] h-2 rounded-full overflow-hidden border border-[#2e2e2e]">
              <div 
                className="bg-gradient-to-r from-[#0369a1] to-[#0369a1] h-full transition-all duration-150 rounded-full"
                style={{ width: `${Math.max(5, loadingProgress.percent)}%` }}
              />
            </div>
            <span className="text-xs font-mono font-medium text-[#38bdf8]">{loadingProgress.percent}%</span>
          </div>
        </div>
      )}

      {/* Overlay visuel lors du glisser-déposer */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-[#181818]/90 backdrop-blur-sm border-2 border-dashed border-[#0ea5e9] flex flex-col items-center justify-center pointer-events-none">
          <div className="bg-[#262626] p-6 rounded-lg border border-[#0ea5e9]/50 shadow-2xl flex flex-col items-center space-y-3">
            <span className="text-4xl">📂</span>
            <div className="text-base font-semibold text-white">Déposer votre fichier ici</div>
            <div className="text-xs text-[#aaaaaa]">Supporte .ESP, .ESM, .ESL, .STRINGS, .SST, .TXT, .CSV, .JSON</div>
          </div>
        </div>
      )}

      {/* Input de fichier caché */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".esp,.esm,.esl,.strings,.dlstrings,.ilstrings,.txt,.csv,.json,.sst"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Barre de titre native macOS et en-tête mTRANSLATOR (design Codex) */}
      <MacTitleBar
        meta={meta}
        modifiedCount={modifiedCount}
        isFileLoaded={isFileLoaded}
        onSelectGame={(newGame: GameEngine) => {
          setMeta((prev) => ({ ...prev, game: newGame }));
          showToast(`Profil de jeu basculé sur : ${newGame}`);
        }}
        onSave={handleSave}
        onCloseFile={handleCloseFile}
        onOpenAbout={() => setIsAboutModalOpen(true)}
      />

      {/* Barre d'outils mTRANSLATOR (design Codex) */}
      <Toolbar
        stats={stats}
        filter={filter}
        recordTypes={recordTypes}
        scriptCount={scriptCount}
        isFileLoaded={isFileLoaded}
        onFilterChange={setFilter}
        onOpenSample={handleOpenSample}
        onOpenFileClick={handleOpenFile}
        onSave={handleSave}
        onExport={handleExport}
        onOpenDictionaryModal={() => setIsDictionaryModalOpen(true)}
        onOpenAiTranslateModal={() => setIsAiModalOpen(true)}
        onOpenFindReplaceModal={() => setIsFindReplaceModalOpen(true)}
        onOpenStatsModal={() => setIsStatsModalOpen(true)}
        onOpenDiffModal={() => setIsDiffModalOpen(true)}
        onOpenBatchModal={() => setIsBatchModalOpen(true)}
        onOpenMacAppModal={() => setIsMacAppModalOpen(true)}
        onOpenAbout={() => setIsAboutModalOpen(true)}
        onValidateAndNext={() => {
          if (selectedId) {
            handleValidate(selectedId);
            handleNextUntranslated();
          }
        }}
        onUndo={handleUndo}
      />

      {/* Zone principale : Écran d'accueil Codex OU Espace de traduction */}
      {!isFileLoaded ? (
        <CodexWelcomeScreen
          onOpenFileClick={handleOpenFile}
          onOpenSample={handleOpenSample}
          onOpenAbout={() => setIsAboutModalOpen(true)}
        />
      ) : (
        <>
          {/* Grille des chaînes */}
          <StringTable
            records={displayedRecords}
            selectedId={selectedId}
            onSelectRecord={(rec) => setSelectedId(rec.id)}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSort={handleSort}
            dictionaries={dictionaries}
            onQuickApplySuggestion={(recordId, suggestion) => {
              handleUpdateTarget(recordId, suggestion, true);
              showToast('Suggestion du dictionnaire appliquée avec succès !');
            }}
            onApplyExactSstMatches={() => handleApplyDictionary('exact')}
            onXtTranslate={pluginPath && xtReady ? () => void applyDictionaryXt('fuzzy') : undefined}
            onOpenAiTranslateModal={() => setIsAiModalOpen(true)}
          />

          {/* Volet inférieur : Éditeur de traduction en Split View */}
          <TranslationEditor
            record={selectedRecord}
            dictionaries={dictionaries}
            onUpdateTarget={handleUpdateTarget}
            onValidate={handleValidate}
            onMarkIdentical={handleMarkIdentical}
            onTranslateSingleWithAi={handleTranslateSingleWithAi}
            onNextUntranslated={handleNextUntranslated}
            onPrevRecord={handlePrevRecord}
            onNextRecord={handleNextRecord}
            onSearchSuggestions={searchSuggestions}
          />

          {/* Barre de statut macOS inférieure */}
          <div className="h-6 bg-[#181818] border-t border-[#2e2e2e] px-3 flex items-center justify-between text-[10px] text-[#666666]">
            <div className="flex items-center space-x-3">
              <span className="flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                <span>mTRANSLATOR v2.5</span>
              </span>
              <span>•</span>
              <span>{displayedRecords.length} / {records.length} enregistrements</span>
              <span>•</span>
              <span>Format : {meta.fileType}</span>
              <span>•</span>
              <span>Jeu : {meta.game}</span>
            </div>

            <div className="flex items-center space-x-3">
              <span>Raccourcis : F10 (Valider & Suivant) | ⌘S (Enregistrer) | ▲▼ (Naviguer)</span>
              <span>•</span>
              <span className="text-[#38bdf8] font-medium">{stats.percentage}% Traduit</span>
            </div>
          </div>
        </>
      )}

      {/* Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-9 right-4 z-50 bg-[#222222] border border-[#0ea5e9] text-[#dddddd] px-3.5 py-2 rounded shadow-2xl flex items-center space-x-2 text-xs animate-in fade-in slide-in-from-bottom-2">
          <Info className="w-4 h-4 text-[#38bdf8] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Modales spécialisées */}
      <DictionaryModal
        isOpen={isDictionaryModalOpen}
        onClose={() => setIsDictionaryModalOpen(false)}
        dictionaries={dictionaries}
        onApplyDictionary={handleApplyDictionary}
        xtMode={Boolean(pluginPath && xtReady)}
        onImportDictionary={handleImportDictionary}
        onResetDictionaries={handleResetDictionaries}
        currentRecords={records}
        currentGame={meta.game}
      />

      <AiBatchTranslateModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        untranslatedRecords={records.filter((r) => r.status === 'untranslated')}
        game={meta.game}
        dictionaries={dictionaries}
        onApplyBatchTranslations={handleApplyBatchTranslations}
      />

      <FindReplaceModal
        isOpen={isFindReplaceModalOpen}
        onClose={() => setIsFindReplaceModalOpen(false)}
        records={records}
        onBatchReplace={handleBatchReplace}
      />

      <StatsModal
        isOpen={isStatsModalOpen}
        onClose={() => setIsStatsModalOpen(false)}
        stats={stats}
        meta={meta}
      />

      <DiffModal
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
        currentRecords={records}
        onMergeNewRecords={handleMergeNewRecords}
      />

      <BatchFilesModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        currentGame={meta.game}
        dictionaries={dictionaries}
        onLoadFileIntoWorkspace={(newRecords, newMeta) => {
          setRecords(newRecords);
          setMeta(newMeta);
          setSelectedId(newRecords[0]?.id || null);
          showToast(`Fichier ${newMeta.fileName} chargé dans l'espace de travail (${newRecords.length} entrées)`);
        }}
      />

      <MacAppModal
        isOpen={isMacAppModalOpen}
        onClose={() => setIsMacAppModalOpen(false)}
      />

      <SavePluginModal
        isOpen={isSavePluginModalOpen}
        meta={meta}
        records={records}
        originalBuffer={originalBuffer}
        fileHandle={fileHandle}
        onUpdateFileHandle={setFileHandle}
        onClose={() => setIsSavePluginModalOpen(false)}
        onSaveSuccess={(msg) => {
          showToast(msg);
          setRecords((prev) => prev.map((r) => ({ ...r, modified: false })));
        }}
      />

      {isAboutModalOpen && (
        <AboutModal onClose={() => setIsAboutModalOpen(false)} />
      )}
    </div>
  );
}
