/**
 * Modal de gestion des Dictionnaires SST et Base de Données mTRANSLATOR
 * Supporte :
 * 1. Création de nouveaux dictionnaires SST XML dans la langue choisie
 * 2. Base Locale Auto-Alimentée (scan en priorité absolue, persistance IndexedDB)
 * 3. Dictionnaires vierges par défaut (0 entrée au démarrage) et chargement de tests en mode Dev
 * 4. Importation multi-fichiers en lot (SST XML, TXT tabulé, CSV, JSON)
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  X, 
  BookMarked, 
  Upload, 
  Search, 
  Check, 
  Sparkles, 
  Database, 
  FileText, 
  Download, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle,
  FileCheck,
  Layers,
  FolderOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PlusCircle,
  Globe,
  Trash2,
  FlaskConical
} from 'lucide-react';
import { DictionaryEntry, ModRecord, GameEngine } from '../types';
import { parseMultipleSSTFiles, BatchSSTResult, BatchSSTProgress } from '../utils/sstParser';
import { triggerFileDownload } from '../utils/translatorUtils';
import { localDictStore } from '../utils/localDictionaryStore';
import { LocalDictionaryManager } from './LocalDictionaryManager';
import { useI18n } from '../i18n/LanguageContext';

interface DictionaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  dictionaries: DictionaryEntry[];
  /** Plugin ouvert par xtcore : traduction par les dictionnaires SST du disque. */
  xtMode?: boolean;
  onApplyDictionary: (matchType: 'exact' | 'fuzzy') => { appliedCount: number } | Promise<{ appliedCount: number }>;
  onImportDictionary: (entries: DictionaryEntry[], batchReport?: BatchSSTResult) => void;
  onResetDictionaries?: () => void;
  currentRecords?: ModRecord[];
  currentGame?: GameEngine;
}

export const DictionaryModal: React.FC<DictionaryModalProps> = ({
  isOpen,
  onClose,
  dictionaries,
  onApplyDictionary,
  xtMode = false,
  onImportDictionary,
  onResetDictionaries,
  currentRecords = [],
  currentGame = 'Skyrim Special Edition',
}) => {
  const { t, targetLang, targetLocale, sourceLang, languages } = useI18n();
  const [activeTab, setActiveTab] = useState<'create_sst' | 'local_db' | 'all_entries'>('create_sst');
  const [search, setSearch] = useState('');
  const [gameFilter, setGameFilter] = useState('all');
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchSSTProgress | null>(null);
  const [batchReport, setBatchReport] = useState<BatchSSTResult | null>(null);
  const [localStats, setLocalStats] = useState(localDictStore.getStats());
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // État du formulaire de création d'un nouveau dictionnaire SST
  const [newSstName, setNewSstName] = useState(() => {
    const prefix = currentGame.includes('Skyrim') ? 'Skyrim' : currentGame.includes('Fallout') ? 'Fallout4' : 'Starfield';
    return `${prefix}_${targetLocale.toUpperCase()}.sst`;
  });
  const [newSstGame, setNewSstGame] = useState<string>(currentGame);
  const [newSstSourceLang, setNewSstSourceLang] = useState<string>(sourceLang);
  const [newSstTargetLang, setNewSstTargetLang] = useState<string>(targetLang);
  const [newSstMode, setNewSstMode] = useState<'empty' | 'from_mod'>('from_mod');

  // Mettre à jour les suggestions quand la langue change
  useEffect(() => {
    setNewSstTargetLang(targetLang);
    const prefix = currentGame.includes('Skyrim') ? 'Skyrim' : currentGame.includes('Fallout') ? 'Fallout4' : 'Starfield';
    setNewSstName(`${prefix}_${targetLocale.toUpperCase()}.sst`);
  }, [targetLang, targetLocale, currentGame]);

  useEffect(() => {
    const unsub = localDictStore.subscribe(() => {
      setLocalStats(localDictStore.getStats());
    });
    return unsub;
  }, []);

  const translatedModRecords = useMemo(() => {
    return currentRecords.filter((r) => Boolean(r.target && r.target.trim() && r.target !== r.source));
  }, [currentRecords]);

  const filteredEntries = useMemo(() => {
    if (!isOpen) return [];
    const q = search.trim().toLowerCase();
    return dictionaries.filter((entry) => {
      const matchesSearch = 
        !q ||
        entry.source.toLowerCase().includes(q) ||
        entry.target.toLowerCase().includes(q);
      const matchesGame = gameFilter === 'all' || entry.game === gameFilter;
      return matchesSearch && matchesGame;
    });
  }, [isOpen, dictionaries, search, gameFilter]);

  // Réinitialiser la page quand la recherche ou le filtre change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, gameFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const paginatedEntries = useMemo(() => {
    if (!isOpen) return [];
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredEntries.slice(start, start + PAGE_SIZE);
  }, [isOpen, filteredEntries, currentPage]);

  if (!isOpen) return null;

  // Création d'un nouveau dictionnaire SST
  const handleCreateSstDictionary = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanFileName = newSstName.endsWith('.sst') ? newSstName : `${newSstName}.sst`;

    let entriesToInclude: Array<{ source: string; target: string; formId?: string; edid?: string; recordType?: string }> = [];

    if (newSstMode === 'from_mod') {
      entriesToInclude = translatedModRecords.map((r) => ({
        source: r.source,
        target: r.target,
        formId: r.formId,
        edid: r.edid,
        recordType: r.recordType,
      }));
    }

    const { xml, addedCount } = localDictStore.createSstDictionary({
      name: cleanFileName,
      game: newSstGame,
      sourceLang: newSstSourceLang,
      targetLang: newSstTargetLang,
      entries: entriesToInclude,
    });

    // Téléchargement immédiat du fichier SST pour l'utilisateur
    triggerFileDownload(xml, cleanFileName, 'application/xml;charset=utf-8');

    setAppliedMessage(
      `Dictionnaire SST "${cleanFileName}" créé avec succès en ${newSstTargetLang} (${addedCount} entrées) et intégré à la base active !`
    );
    setTimeout(() => setAppliedMessage(null), 6000);
  };

  // Chargement des dictionnaires de test (version dev)
  const handleLoadDevTestDictionaries = () => {
    const count = localDictStore.loadDevTestDictionaries();
    setAppliedMessage(`Dictionnaires de test Bethesda chargés (${count} entrées) pour l'environnement de développement.`);
    setTimeout(() => setAppliedMessage(null), 5000);
  };

  // Remise à zéro vierge
  const handleResetToCleanSlate = () => {
    if (window.confirm('Voulez-vous vraiment remettre la base à zéro (version vierge sans aucun dictionnaire) ?')) {
      localDictStore.resetToCleanSlate();
      if (onResetDictionaries) onResetDictionaries();
      setAppliedMessage('Base de données remise à zéro : version vierge active.');
      setTimeout(() => setAppliedMessage(null), 4000);
    }
  };

  const handleApply = async (type: 'exact' | 'fuzzy') => {
    const result = await onApplyDictionary(type);
    setAppliedMessage(
      `${result.appliedCount} chaîne(s) traduite(s) avec succès (${type === 'exact' ? '100% exact' : 'Fuzzy match > 75%'}). Le dictionnaire local a été scanné en priorité.`
    );
    setTimeout(() => setAppliedMessage(null), 5000);
  };

  const processFileList = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsProcessingFiles(true);
    setBatchProgress({
      processedFiles: 0,
      totalFiles: fileArray.length,
      currentFileName: 'Démarrage...',
      entriesFoundSoFar: 0,
      percentage: 0,
    });
    setBatchReport(null);

    try {
      const result = await parseMultipleSSTFiles(fileArray, (p) => {
        setBatchProgress(p);
      });
      setBatchReport(result);

      if (result.allEntries.length > 0) {
        await localDictStore.importEntriesAsync(result.allEntries, 'sst_import', (pct) => {
          setBatchProgress((prev) => prev ? {
            ...prev,
            currentFileName: `Intégration base de données (${pct}%)...`,
            percentage: pct,
          } : null);
        });

        onImportDictionary(result.allEntries, result);
        setAppliedMessage(
          `Importation réussie : ${fileArray.length} fichier(s) traité(s), ${result.allEntries.length.toLocaleString()} entrées intégrées sans blocage.`
        );
      } else {
        setAppliedMessage('Aucune entrée valide trouvée dans les fichiers sélectionnés.');
      }
    } catch (err: any) {
      console.error('Erreur importation multi-fichiers:', err);
      setAppliedMessage(`Erreur lors de l'importation : ${err.message || 'Format invalide'}`);
    } finally {
      setIsProcessingFiles(false);
      setBatchProgress(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFileList(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFileList(e.dataTransfer.files);
    }
  };

  // Export complet de la base en SST XML
  const handleExportDatabase = () => {
    const header = `<?xml version="1.0" encoding="utf-8"?>\n<!-- mTRANSLATOR Complete Database Export (${sourceLang} -> ${targetLang}) -->\n<SSTDictionary game="Universal" source="${sourceLang}" target="${targetLang}" count="${dictionaries.length}">\n`;
    const body = dictionaries
      .map((d) => `  <entry>\n    <source>${d.source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</source>\n    <dest>${d.target.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dest>\n  </entry>`)
      .join('\n');
    const xml = header + body + '\n</SSTDictionary>';
    triggerFileDownload(xml, `mTRANSLATOR_Database_${targetLocale.toUpperCase()}_${dictionaries.length}_entries.sst`, 'application/xml;charset=utf-8');
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-[2px] p-4 text-xs select-none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="bg-[#1a1a1a] border border-[#333333] rounded-lg shadow-2xl w-full max-w-4xl flex flex-col h-[670px] overflow-hidden text-[#dddddd]">
        {/* En-tête macOS */}
        <div className="h-10 bg-[#222222] border-b border-[#333333] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <BookMarked className="w-4 h-4 text-[#38bdf8]" />
            <span className="font-semibold text-white">
              {t('dict.modalTitle')}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
              localStats.totalEntries === 0 
                ? 'bg-[#262626] text-[#aaaaaa] border-[#444444]' 
                : 'bg-[#14391f]/40 text-[#4ade80] border-[#22c55e]/50'
            }`}>
              {localStats.totalEntries === 0 
                ? 'Version vierge (0 entrée)' 
                : `${localStats.totalEntries.toLocaleString()} entrées (${targetLang})`}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleLoadDevTestDictionaries}
              className="text-[11px] text-[#fbbf24] hover:text-[#fde68a] bg-[#3f2a0c]/50 hover:bg-[#3f2a0c] border border-[#f59e0b] px-2 py-0.5 rounded flex items-center space-x-1 transition-colors"
              title="Charger les dictionnaires d'exemples Bethesda uniquement pour la phase de test et de développement"
            >
              <FlaskConical className="w-3 h-3 text-[#fbbf24]" />
              <span>Dev : Charger tests</span>
            </button>

            <button
              type="button"
              onClick={handleResetToCleanSlate}
              className="text-[11px] text-[#aaaaaa] hover:text-[#f87171] bg-[#262626] hover:bg-[#262626] border border-[#333333] px-2 py-0.5 rounded flex items-center space-x-1 transition-colors"
              title="Vider tous les dictionnaires et revenir à une version 100% vierge"
            >
              <Trash2 className="w-3 h-3" />
              <span>Remise à zéro vierge</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="text-[#aaaaaa] hover:text-white p-1 rounded hover:bg-[#303030] transition-colors ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barre d'onglets : Créer SST vs Base Locale vs Explorateur */}
        <div className="bg-[#181818] border-b border-[#2e2e2e] px-3 flex items-center justify-between">
          <div className="flex items-center space-x-1">
            {/* Onglet 1 : Créer un nouveau dictionnaire SST */}
            <button
              type="button"
              onClick={() => setActiveTab('create_sst')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center space-x-1.5 transition-colors ${
                activeTab === 'create_sst'
                  ? 'border-[#38bdf8] text-[#38bdf8] bg-[#222222]'
                  : 'border-transparent text-[#aaaaaa] hover:text-white'
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5 text-[#38bdf8]" />
              <span>Créer un dictionnaire SST ({targetLang})</span>
            </button>

            {/* Onglet 2 : Base Locale */}
            <button
              type="button"
              onClick={() => setActiveTab('local_db')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center space-x-1.5 transition-colors ${
                activeTab === 'local_db'
                  ? 'border-[#38bdf8] text-[#38bdf8] bg-[#222222]'
                  : 'border-transparent text-[#aaaaaa] hover:text-white'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Base Locale Auto-Alimentée</span>
              <span className="px-1.5 py-0.2 rounded-full bg-[#0369a1]/30 text-[#38bdf8] text-[9.5px]">
                {localStats.userLearnedEntries}
              </span>
            </button>

            {/* Onglet 3 : Toutes les entrées & Imports */}
            <button
              type="button"
              onClick={() => setActiveTab('all_entries')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center space-x-1.5 transition-colors ${
                activeTab === 'all_entries'
                  ? 'border-[#38bdf8] text-[#38bdf8] bg-[#222222]'
                  : 'border-transparent text-[#aaaaaa] hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Toutes les entrées actives</span>
              <span className="px-1.5 py-0.2 rounded-full bg-[#2c2c2c] text-[#aaaaaa] text-[9.5px]">
                {dictionaries.length.toLocaleString()}
              </span>
            </button>
          </div>

          {/* Raccourci rapide d'application de correspondance exacte */}
          {(xtMode || dictionaries.length > 0) && (
            <div className="flex items-center space-x-1.5 py-1">
              <button
                type="button"
                onClick={() => handleApply('exact')}
                className="px-2 py-1 bg-[#22c55e]/20 hover:bg-[#22c55e]/30 text-[#4ade80] border border-[#22c55e]/40 rounded text-[11px] font-medium flex items-center space-x-1 transition-colors"
                title="Appliquer immédiatement toutes les correspondances exactes"
              >
                <Check className="w-3 h-3" />
                <span>Appliquer exact (100%)</span>
              </button>
              {xtMode && (
                <button
                  type="button"
                  onClick={() => handleApply('fuzzy')}
                  className="px-2 py-1 bg-[#f59e0b]/20 hover:bg-[#f59e0b]/30 text-[#fbbf24] border border-[#f59e0b]/40 rounded text-[11px] font-medium flex items-center space-x-1 transition-colors"
                  title="Correspondances exactes et approchantes (heuristique xTranslator)"
                >
                  <Check className="w-3 h-3" />
                  <span>Exact + approchant</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Message de notification */}
        {appliedMessage && (
          <div className="bg-[#262626] border-b border-[#22c55e] px-4 py-2 text-xs text-[#4ade80] flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{appliedMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setAppliedMessage(null)}
              className="text-[#4ade80] hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Indicateur de traitement multi-fichiers asynchrone non-bloquant */}
        {isProcessingFiles && batchProgress && (
          <div className="bg-[#222222] border-b border-[#333333] px-4 py-2 text-xs">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center space-x-2 text-[#38bdf8] font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{batchProgress.currentFileName}</span>
              </div>
              <span className="text-[11px] font-mono text-[#38bdf8]">
                {batchProgress.processedFiles} / {batchProgress.totalFiles} fichiers ({batchProgress.percentage}%)
              </span>
            </div>
            <div className="w-full bg-[#181818] h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-[#0369a1] h-full transition-all duration-150 rounded-full"
                style={{ width: `${batchProgress.percentage}%` }}
              />
            </div>
          </div>
        )}

        {/* CONTENU SELON L'ONGLET ACTIF */}
        {activeTab === 'create_sst' ? (
          /* FORMULAIRE DE CRÉATION DE NOUVEAU DICTIONNAIRE SST */
          <div className="flex-1 overflow-y-auto p-6 bg-[#181818] custom-scrollbar">
            <div className="max-w-2xl mx-auto space-y-6">
              {/* En-tête de section */}
              <div className="p-4 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg">
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-[#0369a1]/20 border border-[#0369a1]/40 flex items-center justify-center text-[#38bdf8]">
                    <PlusCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white tracking-tight">
                      Créer un nouveau dictionnaire SST
                    </h3>
                    <p className="text-xs text-[#aaaaaa]">
                      Générez un dictionnaire officiel XML .sst dans la langue choisie ({targetLang}), prêt à l&apos;emploi et compatible avec mTRANSLATOR et xTranslator.
                    </p>
                  </div>
                </div>
              </div>

              {/* Formulaire */}
              <form onSubmit={handleCreateSstDictionary} className="space-y-4 bg-[#181818] border border-[#2e2e2e] p-5 rounded-lg">
                {/* 1. Nom du fichier */}
                <div>
                  <label className="block text-xs font-semibold text-[#dddddd] mb-1">
                    Nom du fichier SST (.sst) :
                  </label>
                  <input
                    type="text"
                    value={newSstName}
                    onChange={(e) => setNewSstName(e.target.value)}
                    required
                    className="w-full bg-[#222222] border border-[#333333] rounded px-3 py-1.5 text-xs text-white focus:outline-hidden focus:border-[#38bdf8] font-mono"
                    placeholder="MonMod_FR.sst"
                  />
                  <p className="text-[10.5px] text-[#666666] mt-1">
                    Le format SST XML standard sera automatiquement appliqué avec le nom spécifié.
                  </p>
                </div>

                {/* 2. Jeu cible & Paire de langue */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#dddddd] mb-1">
                      Jeu Bethesda :
                    </label>
                    <select
                      value={newSstGame}
                      onChange={(e) => setNewSstGame(e.target.value)}
                      className="w-full bg-[#222222] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-white focus:outline-hidden focus:border-[#38bdf8]"
                    >
                      <option value="Skyrim Special Edition">Skyrim Special Edition</option>
                      <option value="Fallout 4">Fallout 4</option>
                      <option value="Starfield">Starfield</option>
                      <option value="Skyrim Legendary Edition">Skyrim Legendary Edition</option>
                      <option value="The Elder Scrolls IV: Oblivion">Oblivion</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#dddddd] mb-1">
                      Langue source (VO) :
                    </label>
                    <select
                      value={newSstSourceLang}
                      onChange={(e) => setNewSstSourceLang(e.target.value)}
                      className="w-full bg-[#222222] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-white focus:outline-hidden focus:border-[#38bdf8]"
                    >
                      {languages.map((l) => (
                        <option key={l.code} value={l.name}>
                          {l.flag} {l.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#dddddd] mb-1">
                      Langue cible (VF) :
                    </label>
                    <select
                      value={newSstTargetLang}
                      onChange={(e) => setNewSstTargetLang(e.target.value)}
                      className="w-full bg-[#222222] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-white focus:outline-hidden focus:border-[#38bdf8]"
                    >
                      {languages.map((l) => (
                        <option key={l.code} value={l.name}>
                          {l.flag} {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 3. Contenu initial */}
                <div className="pt-2 border-t border-[#2e2e2e]">
                  <label className="block text-xs font-semibold text-[#dddddd] mb-2">
                    Contenu initial du dictionnaire :
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-start space-x-2.5 p-2.5 rounded bg-[#1e1e1e] border border-[#333333] cursor-pointer hover:border-[#38bdf8]/50 transition-colors">
                      <input
                        type="radio"
                        name="sst_mode"
                        checked={newSstMode === 'from_mod'}
                        onChange={() => setNewSstMode('from_mod')}
                        className="mt-0.5 text-[#38bdf8] focus:ring-0"
                      />
                      <div>
                        <span className="text-xs font-medium text-white block">
                          Alimenter avec les traductions du projet en cours ({translatedModRecords.length} entrées traduites)
                        </span>
                        <span className="text-[11px] text-[#aaaaaa]">
                          Idéal pour transformer vos traductions actuelles en dictionnaire de référence réutilisable sur d&apos;autres mods.
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start space-x-2.5 p-2.5 rounded bg-[#1e1e1e] border border-[#333333] cursor-pointer hover:border-[#38bdf8]/50 transition-colors">
                      <input
                        type="radio"
                        name="sst_mode"
                        checked={newSstMode === 'empty'}
                        onChange={() => setNewSstMode('empty')}
                        className="mt-0.5 text-[#38bdf8] focus:ring-0"
                      />
                      <div>
                        <span className="text-xs font-medium text-white block">
                          Dictionnaire vierge (0 entrée initiale)
                        </span>
                        <span className="text-[11px] text-[#aaaaaa]">
                          Structure XML standard vide, à alimenter manuellement au fil des sessions.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Bouton de soumission */}
                <div className="pt-3 flex items-center justify-end space-x-3">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#0369a1] hover:bg-[#0369a1] text-white font-semibold rounded shadow-md transition-all flex items-center space-x-2 text-xs"
                  >
                    <Download className="w-4 h-4" />
                    <span>Créer et exporter le dictionnaire SST (.sst)</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : activeTab === 'local_db' ? (
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#181818]">
            <LocalDictionaryManager onApplyDictionary={onApplyDictionary} />
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Barre d'actions pour l'onglet dictionnaire global */}
            <div className="p-3 bg-[#181818] border-b border-[#2e2e2e] flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center space-x-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".sst,.xml,.txt,.tsv,.csv,.json"
                  onChange={handleFileInputChange}
                  className="hidden"
                  id="multi-sst-file-input"
                />
                <label
                  htmlFor="multi-sst-file-input"
                  className="px-3 py-1.5 bg-[#0c3a52] hover:bg-[#0c4a6e] text-[#38bdf8] border border-[#0ea5e9]/50 rounded cursor-pointer transition-colors flex items-center space-x-1.5 font-medium shadow-sm"
                  title="Sélectionnez un ou PLUSIEURS fichiers SST, TXT ou CSV en maintenant Ctrl ou Cmd"
                >
                  <Upload className="w-3.5 h-3.5 text-[#38bdf8]" />
                  <span>Importer un lot de fichiers SST / TXT</span>
                </label>

                {/* Export de la Database */}
                <button
                  type="button"
                  onClick={handleExportDatabase}
                  className="px-2.5 py-1.5 bg-[#262626] hover:bg-[#303030] text-[#dddddd] border border-[#444444] rounded transition-colors flex items-center space-x-1"
                  title="Exporter toute la base de données au format SST XML"
                >
                  <Download className="w-3.5 h-3.5 text-[#aaaaaa]" />
                  <span>Exporter SST ({targetLang})</span>
                </button>
              </div>

              {/* Remise à zéro vierge */}
              <button
                type="button"
                onClick={handleResetToCleanSlate}
                className="px-2.5 py-1.5 bg-[#262626] hover:bg-[#303030] text-[#aaaaaa] hover:text-[#f87171] border border-[#444444] rounded transition-colors flex items-center space-x-1"
                title="Vider et remettre la base à zéro (0 entrée)"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider la base</span>
              </button>
            </div>

            {/* Zone de Glisser-Déposer multi-fichiers */}
            <div 
              className={`mx-3 mt-3 p-2.5 rounded-md border-2 border-dashed transition-all flex items-center justify-between ${
                isDragging 
                  ? 'bg-[#0c3a52]/40 border-[#38bdf8] text-[#ffffff] scale-[1.005]' 
                  : 'bg-[#181818] border-[#2e2e2e] text-[#aaaaaa]'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <div className="w-7 h-7 rounded-full bg-[#262626] flex items-center justify-center text-[#38bdf8]">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="font-semibold text-[#ffffff] text-[11px] block">
                    Glissez-déposez vos fichiers .SST, .TXT ou .CSV ici
                  </span>
                  <p className="text-[10px] text-[#666666]">
                    Les entrées importées alimenteront également votre base locale persistante pour {targetLang}.
                  </p>
                </div>
              </div>
              <div className="text-[10px] bg-[#262626] px-2 py-1 rounded text-[#38bdf8] font-mono">
                Support multi-fichiers &amp; micro-tâches
              </div>
            </div>

            {/* Barre de recherche et filtres de jeu */}
            <div className="p-3 flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-[#666666] absolute left-2.5 top-2" />
                <input
                  type="text"
                  placeholder="Rechercher dans les sources ou traductions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-[#181818] border border-[#333333] rounded pl-8 pr-3 py-1.5 text-xs text-[#dddddd] focus:outline-hidden focus:border-[#38bdf8]"
                />
              </div>

              <select
                value={gameFilter}
                onChange={(e) => setGameFilter(e.target.value)}
                className="bg-[#181818] border border-[#333333] rounded px-2.5 py-1.5 text-xs text-[#dddddd] focus:outline-hidden"
              >
                <option value="all">Tous les univers ({dictionaries.length.toLocaleString()})</option>
                <option value="Skyrim Special Edition">Skyrim Special Edition</option>
                <option value="Fallout 4">Fallout 4</option>
                <option value="Starfield">Starfield</option>
              </select>
            </div>

            {/* Tableau des entrées paginé */}
            <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-[#181818] text-[#aaaaaa] sticky top-0 z-10 border-b border-[#2e2e2e]">
                  <tr>
                    <th className="py-2 px-3 font-semibold w-1/3">Source (VO)</th>
                    <th className="py-2 px-3 font-semibold w-1/3">Traduction ({targetLang})</th>
                    <th className="py-2 px-3 font-semibold">Jeu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2e2e2e]">
                  {paginatedEntries.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-12 text-center text-[#666666]">
                        <BookMarked className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="font-medium text-white text-xs">Aucune entrée trouvée</p>
                        <p className="text-[11px] text-[#aaaaaa] mt-1">
                          {dictionaries.length === 0 
                            ? 'La base est actuellement vierge (0 entrée). Vous pouvez importer vos fichiers SST ou créer un nouveau dictionnaire.'
                            : 'Aucune entrée ne correspond aux critères de recherche.'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    paginatedEntries.map((entry, idx) => (
                      <tr key={idx} className="hover:bg-[#1e1e1e] transition-colors">
                        <td className="py-2 px-3 font-mono text-[11px] text-[#dddddd] select-text">
                          {entry.source}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-[#4ade80] select-text">
                          {entry.target}
                        </td>
                        <td className="py-2 px-3 text-[#aaaaaa] text-[10.5px]">
                          <span className="px-1.5 py-0.5 rounded bg-[#262626] border border-[#333333]">
                            {entry.game}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="h-9 bg-[#181818] border-t border-[#2e2e2e] px-4 flex items-center justify-between text-xs text-[#aaaaaa]">
                <span>
                  Affichage de {((currentPage - 1) * PAGE_SIZE) + 1} à {Math.min(currentPage * PAGE_SIZE, filteredEntries.length)} sur {filteredEntries.length.toLocaleString()}
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="p-1 rounded hover:bg-[#262626] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-mono text-[#dddddd]">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="p-1 rounded hover:bg-[#262626] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
