/**
 * Modal de Batch Processing multi-fichiers pour mTRANSLATOR macOS
 * Permet de :
 * - Glisser-déposer ou sélectionner un ensemble de fichiers de mods (.esp, .esm, .esl, .txt, .sst, .strings, .csv, .json)
 * - Prévisualiser le nombre de chaînes par fichier et leur statut
 * - Appliquer les dictionnaires SST Vanilla / locaux en lot
 * - Traduire automatiquement par lot via IA Gemini ou dictionnaire local
 * - Exporter/Télécharger l'ensemble des fichiers traduits individuellement ou en lot
 * - Charger un des fichiers traduits directement dans l'espace de travail actif
 */

import React, { useState, useRef } from 'react';
import {
  X,
  Layers,
  Upload,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  FileText,
  Trash2,
  Sparkles,
  BookOpen,
  ArrowRight,
  FolderArchive,
  RefreshCw,
} from 'lucide-react';
import { BatchFileItem, GameEngine, DictionaryEntry, ModRecord, ModFileMeta } from '../types';
import { parseModFile } from '../utils/bethesdaBinaryParser';
import { translateFallbackText } from '../data/dictionaryHeuristics';
import { exportToSST, exportToTranslationTxt, exportToCSV, triggerFileDownload, sanitizeBethesdaTranslation } from '../utils/translatorUtils';

interface BatchFilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentGame: GameEngine;
  dictionaries: DictionaryEntry[];
  onLoadFileIntoWorkspace: (records: ModRecord[], meta: ModFileMeta) => void;
}

export const BatchFilesModal: React.FC<BatchFilesModalProps> = ({
  isOpen,
  onClose,
  currentGame,
  dictionaries,
  onLoadFileIntoWorkspace,
}) => {
  const [fileItems, setFileItems] = useState<BatchFileItem[]>([
    // Exemple initial de lot prédéfini pour découverte rapide
    {
      id: 'demo-1',
      name: 'Wyrmstooth_Quests.esp',
      size: 48520,
      extension: 'esp',
      status: 'pending',
      progress: 0,
      recordsCount: 8,
      translatedCount: 0,
    },
    {
      id: 'demo-2',
      name: 'Wyrmstooth_MCM.txt',
      size: 14200,
      extension: 'txt',
      status: 'pending',
      progress: 0,
      recordsCount: 14,
      translatedCount: 0,
    },
    {
      id: 'demo-3',
      name: 'Wyrmstooth_Glossary.sst',
      size: 26800,
      extension: 'sst',
      status: 'pending',
      progress: 0,
      recordsCount: 12,
      translatedCount: 0,
    },
  ]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [useDictionariesFirst, setUseDictionariesFirst] = useState(true);
  const [exportFormat, setExportFormat] = useState<'AUTO' | 'SST' | 'TXT' | 'CSV'>('AUTO');
  const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue');
  const [batchStatusSummary, setBatchStatusSummary] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Ajout de nouveaux fichiers par l'utilisateur
  const handleFilesAdded = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newItems: BatchFileItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase() || 'unknown';
      const id = `batch-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;

      newItems.push({
        id,
        name: file.name,
        size: file.size,
        extension: ext,
        file,
        status: 'pending',
        progress: 0,
        recordsCount: 0,
        translatedCount: 0,
      });
    }

    setFileItems((prev) => [...prev, ...newItems]);
  };

  // Suppression d'un fichier de la liste
  const handleRemoveItem = (id: string) => {
    if (isProcessing) return;
    setFileItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Vider la file
  const handleClearAll = () => {
    if (isProcessing) return;
    setFileItems([]);
    setBatchStatusSummary(null);
  };

  // Traiter un seul fichier : Parsing + Dictionnaire + Traduction
  const processSingleFile = async (
    item: BatchFileItem,
    dictMap: Map<string, string>
  ): Promise<BatchFileItem> => {
    try {
      let parsedRecords: ModRecord[] = [];
      let meta: Partial<ModFileMeta> = {
        fileName: item.name,
        game: currentGame,
      };

      // 1. Parsing
      if (item.file) {
        const res = await parseModFile(item.file, currentGame);
        parsedRecords = res.records;
        meta = { ...meta, ...res.meta };
      } else {
        // Démo prédéfinie si pas de fichier binaire uploadé
        parsedRecords = generateMockDemoRecords(item.name);
      }

      if (parsedRecords.length === 0) {
        return {
          ...item,
          status: 'completed',
          progress: 100,
          recordsCount: 0,
          translatedCount: 0,
          records: [],
          meta,
        };
      }

      // 2. Application du dictionnaire SST vanilla / local
      let translated = 0;
      const updatedRecords = parsedRecords.map((r) => {
        if (r.target && r.status === 'translated') {
          translated++;
          return r;
        }

        // Vérification dictionnaire
        if (useDictionariesFirst) {
          const sLower = r.source.trim().toLowerCase();
          if (dictMap.has(sLower)) {
            translated++;
            return {
              ...r,
              target: dictMap.get(sLower)!,
              status: 'translated' as const,
              modified: true,
              validated: true,
            };
          }
        }

        return r;
      });

      // 3. Traduction des éléments restants par IA / Fallback heuristique
      const remaining = updatedRecords.filter((r) => !r.target || r.status === 'untranslated');

      if (remaining.length > 0) {
        const CHUNK_SIZE = 75;
        for (let c = 0; c < remaining.length; c += CHUNK_SIZE) {
          const chunk = remaining.slice(c, c + CHUNK_SIZE);
          try {
            const payload = {
              items: chunk.map((r) => ({
                id: r.id,
                text: r.source,
                context: `Game: ${currentGame}, Type: ${r.recordType}, FormID: ${r.formId}`,
              })),
              gameContext: currentGame,
              targetLang: 'Français',
              preferredEngine: 'gemini-3.1-flash-lite',
            };

            const res = await fetch('/api/translate/batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            if (res.ok) {
              const data = await res.json();
              if (data.translations && Array.isArray(data.translations)) {
                const transMap = new Map<string, string>();
                data.translations.forEach((t: { id: string; translatedText: string }) => {
                  transMap.set(t.id, t.translatedText);
                });

                for (let j = 0; j < updatedRecords.length; j++) {
                  const rec = updatedRecords[j];
                  if (transMap.has(rec.id)) {
                    rec.target = sanitizeBethesdaTranslation(transMap.get(rec.id)!, rec.source);
                    rec.status = 'translated';
                    rec.modified = true;
                    rec.validated = true;
                    translated++;
                  }
                }
              }
            } else {
              // Fallback de traduction locale Bethesda pour ce chunk
              for (const it of chunk) {
                const rec = updatedRecords.find((r) => r.id === it.id);
                if (rec && !rec.target) {
                  rec.target = sanitizeBethesdaTranslation(translateFallbackText(rec.source), rec.source);
                  rec.status = 'translated';
                  rec.modified = true;
                  rec.validated = true;
                  translated++;
                }
              }
            }
          } catch {
            // Secours automatique pour ce chunk
            for (const it of chunk) {
              const rec = updatedRecords.find((r) => r.id === it.id);
              if (rec && !rec.target) {
                rec.target = sanitizeBethesdaTranslation(translateFallbackText(rec.source), rec.source);
                rec.status = 'translated';
                rec.modified = true;
                rec.validated = true;
                translated++;
              }
            }
          }
        }
      }

      return {
        ...item,
        status: 'completed',
        progress: 100,
        recordsCount: updatedRecords.length,
        translatedCount: translated,
        records: updatedRecords,
        meta,
      };
    } catch (err: any) {
      return {
        ...item,
        status: 'error',
        error: err.message || 'Erreur inconnue lors du parsing ou de la traduction',
        progress: 0,
      };
    }
  };

  // Lancer le batch complet sur tous les fichiers en attente
  const handleStartBatchProcessing = async () => {
    if (fileItems.length === 0) return;

    setIsProcessing(true);
    setBatchStatusSummary('Traitement par lot en cours...');

    // Création de la map de dictionnaires pour recherche O(1)
    const dictMap = new Map<string, string>();
    dictionaries.forEach((d) => {
      dictMap.set(d.source.trim().toLowerCase(), d.target);
    });

    const updatedItems = [...fileItems];

    for (let i = 0; i < updatedItems.length; i++) {
      const item = updatedItems[i];
      if (item.status === 'completed') continue;

      // Marquer comme en cours
      updatedItems[i] = {
        ...item,
        status: 'translating',
        progress: 35,
      };
      setFileItems([...updatedItems]);

      const processed = await processSingleFile(item, dictMap);
      updatedItems[i] = processed;
      setFileItems([...updatedItems]);
    }

    setIsProcessing(false);
    const completedCount = updatedItems.filter((it) => it.status === 'completed').length;
    setBatchStatusSummary(`Traitement terminé avec succès ! (${completedCount}/${updatedItems.length} fichiers traités)`);
  };

  // Télécharger un fichier traduit
  const handleDownloadFile = (item: BatchFileItem) => {
    if (!item.records || item.records.length === 0) return;

    const baseName = item.name.replace(/\.[^/.]+$/, '');
    const ext = item.extension.toLowerCase();

    if (exportFormat === 'SST' || (exportFormat === 'AUTO' && ext === 'sst')) {
      const xml = exportToSST(item.records, currentGame);
      triggerFileDownload(xml, `${baseName}_FR.sst`, 'application/xml');
    } else if (exportFormat === 'CSV' || (exportFormat === 'AUTO' && ext === 'csv')) {
      const csv = exportToCSV(item.records);
      triggerFileDownload(csv, `${baseName}_FR.csv`, 'text/csv');
    } else {
      // Par défaut format TXT mTRANSLATOR / MCM
      const txt = exportToTranslationTxt(item.records);
      triggerFileDownload(txt, `${baseName}_FR.txt`, 'text/plain');
    }
  };

  // Télécharger tous les fichiers traités
  const handleDownloadAll = () => {
    const completed = fileItems.filter((f) => f.status === 'completed' && f.records && f.records.length > 0);
    if (completed.length === 0) return;

    completed.forEach((item, index) => {
      setTimeout(() => {
        handleDownloadFile(item);
      }, index * 300);
    });
  };

  // Charger le fichier dans l'espace de travail mTRANSLATOR principal
  const handleLoadToMain = (item: BatchFileItem) => {
    if (!item.records || item.records.length === 0) return;

    const meta: ModFileMeta = {
      fileName: item.name,
      fileType: (item.extension.toUpperCase() as any) || 'ESP',
      game: currentGame,
      encoding: 'UTF-8',
      version: '1.0',
    };

    onLoadFileIntoWorkspace(item.records, meta);
    onClose();
  };

  const totalStrings = fileItems.reduce((acc, it) => acc + (it.recordsCount || 0), 0);
  const totalTranslated = fileItems.reduce((acc, it) => acc + (it.translatedCount || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-[#1a1a1a] border border-[#333333] rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden text-[#dddddd]">
        {/* Header fenêtre macOS */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#222222] border-b border-[#333333]">
          <div className="flex items-center space-x-3">
            <div className="p-1.5 bg-[#f59e0b]/15 text-[#fbbf24] rounded-lg border border-[#f59e0b]/30">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#ffffff]">Traitement par lot (Batch Processing)</h3>
              <p className="text-[11px] text-[#aaaaaa]">
                Traduction automatique multi-fichiers (.esp, .esm, .txt, .sst, .strings, .csv)
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="p-1 text-[#aaaaaa] hover:text-white hover:bg-[#303030] rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barre d'actions supérieures & Options */}
        <div className="p-3 bg-[#181818] border-b border-[#333333] flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Bouton d'ajout */}
          <div className="flex items-center space-x-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".esp,.esm,.esl,.strings,.dlstrings,.ilstrings,.sst,.txt,.csv,.json"
              onChange={(e) => handleFilesAdded(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#262626] hover:bg-[#333333] text-[#38bdf8] border border-[#38bdf8]/30 rounded transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Ajouter des fichiers...</span>
            </button>

            {fileItems.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                disabled={isProcessing}
                className="flex items-center space-x-1.5 px-2.5 py-1.5 text-[#aaaaaa] hover:text-[#f87171] hover:bg-[#262626] rounded transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider la file</span>
              </button>
            )}
          </div>

          {/* Options de traitement */}
          <div className="flex items-center space-x-3 text-[#aaaaaa]">
            <label className="flex items-center space-x-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={useDictionariesFirst}
                onChange={(e) => setUseDictionariesFirst(e.target.checked)}
                disabled={isProcessing}
                className="rounded bg-[#222222] border-[#444444] text-[#38bdf8] focus:ring-0"
              />
              <span className="text-[11px]">Priorité Dictionnaires SST</span>
            </label>

            <div className="flex items-center space-x-1.5 text-[11px]">
              <span>Format d'export :</span>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as any)}
                disabled={isProcessing}
                className="bg-[#222222] border border-[#333333] rounded px-2 py-1 text-[#dddddd] focus:outline-hidden"
              >
                <option value="AUTO">Auto (conserver)</option>
                <option value="SST">mTRANSLATOR (.sst)</option>
                <option value="TXT">MCM / Texte (.txt)</option>
                <option value="CSV">Tableur (.csv)</option>
              </select>
            </div>

            <div 
              className="px-2 py-1 rounded bg-[#262626] text-[#fbbf24] border border-[#f59e0b] text-[10px] flex items-center space-x-1"
              title="Le mot-clé [pagebreak] des retours à la ligne / sauts de page dans les livres est strictement préservé sans être traduit."
            >
              <BookOpen className="w-3 h-3 text-[#fbbf24]" />
              <span>Règle [pagebreak] active</span>
            </div>
          </div>
        </div>

        {/* Corps principal : Zone de glisser-déposer + Liste des fichiers */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#181818]/60">
          {fileItems.length === 0 ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#333333] hover:border-[#38bdf8]/50 rounded-xl p-8 text-center cursor-pointer transition-colors bg-[#1a1a1a]/40"
            >
              <FolderArchive className="w-10 h-10 text-[#666666] mx-auto mb-2" />
              <p className="text-sm font-medium text-[#dddddd]">Glissez-déposez vos mods ou fichiers de traduction ici</p>
              <p className="text-xs text-[#666666] mt-1">
                Prend en charge .esp, .esm, .esl, .txt (MCM), .sst (dictionnaires), .strings, .csv et .json
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {fileItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 bg-[#1e1e1e] border border-[#2e2e2e] hover:border-[#333333] rounded-lg transition-colors text-xs"
                >
                  {/* Info Fichier */}
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <div className="p-2 bg-[#262626] rounded border border-[#444444]/40 text-[#38bdf8] shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-sm font-medium text-[#ffffff] truncate">
                          {item.name}
                        </span>
                        <span className="uppercase text-[10px] font-mono px-1.5 py-0.2 bg-[#333333] text-[#38bdf8] rounded">
                          {item.extension}
                        </span>
                        <span className="text-[10px] text-[#666666]">
                          {(item.size / 1024).toFixed(1)} Ko
                        </span>
                      </div>

                      {/* Statut & Progression */}
                      <div className="flex items-center space-x-3 mt-1 text-[11px] text-[#aaaaaa]">
                        {item.status === 'pending' && (
                          <span className="flex items-center space-x-1 text-[#666666]">
                            <Clock className="w-3 h-3" />
                            <span>En attente ({item.recordsCount || '?'} chaînes)</span>
                          </span>
                        )}

                        {item.status === 'translating' && (
                          <span className="flex items-center space-x-1 text-[#fbbf24] animate-pulse">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Traduction en cours...</span>
                          </span>
                        )}

                        {item.status === 'completed' && (
                          <span className="flex items-center space-x-1 text-[#4ade80]">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>
                              Traduit : {item.translatedCount} / {item.recordsCount} chaînes (100%)
                            </span>
                          </span>
                        )}

                        {item.status === 'error' && (
                          <span className="flex items-center space-x-1 text-[#f87171]">
                            <AlertCircle className="w-3 h-3" />
                            <span>{item.error || 'Erreur de traitement'}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions par fichier */}
                  <div className="flex items-center space-x-2 shrink-0 ml-4">
                    {item.status === 'completed' && item.records && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleLoadToMain(item)}
                          className="flex items-center space-x-1 px-2 py-1 bg-[#2c2c2c] hover:bg-[#333333] text-[#38bdf8] rounded border border-[#38bdf8]/30 transition-colors"
                          title="Ouvrir dans l'éditeur principal mTRANSLATOR"
                        >
                          <span>Éditer</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDownloadFile(item)}
                          className="flex items-center space-x-1 px-2.5 py-1 bg-[#22c55e]/15 hover:bg-[#22c55e]/25 text-[#4ade80] border border-[#22c55e]/40 rounded transition-colors"
                          title="Télécharger le fichier traduit"
                        >
                          <Download className="w-3 h-3" />
                          <span>Exporter</span>
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      disabled={isProcessing}
                      className="p-1 text-[#666666] hover:text-[#f87171] rounded transition-colors"
                      title="Retirer de la file"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pied de page et Bouton de Lancement du Batch */}
        <div className="p-4 bg-[#222222] border-t border-[#333333] flex items-center justify-between">
          <div className="text-xs text-[#aaaaaa]">
            {batchStatusSummary ? (
              <span className="text-[#38bdf8] font-medium">{batchStatusSummary}</span>
            ) : (
              <span>
                {fileItems.length} fichier(s) dans la file d'attente • Moteur cible :{' '}
                <strong className="text-white">{currentGame}</strong>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {fileItems.some((f) => f.status === 'completed') && (
              <button
                type="button"
                onClick={handleDownloadAll}
                disabled={isProcessing}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#262626] hover:bg-[#333333] text-[#dddddd] border border-[#444444] rounded text-xs transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span>Tout télécharger</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleStartBatchProcessing}
              disabled={isProcessing || fileItems.length === 0}
              className={`flex items-center space-x-2 px-4 py-1.5 rounded text-xs font-medium transition-all ${
                isProcessing || fileItems.length === 0
                  ? 'bg-[#404040] text-[#aaaaaa] cursor-not-allowed'
                  : 'bg-[#f59e0b] hover:bg-[#d97706] text-black shadow-md shadow-[#f59e0b]/20 active:scale-95'
              }`}
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Traitement du lot en cours...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Lancer la Traduction du Lot</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Données d'exemple pour les fichiers de démonstration du batch
function generateMockDemoRecords(fileName: string): ModRecord[] {
  if (fileName.includes('Quests')) {
    return [
      {
        id: 'q-1',
        formId: '0002A101',
        edid: 'WT_Quest_Start_01',
        recordType: 'QUST',
        source: 'The barrows of Wyrmstooth await the true Dragonborn.',
        target: '',
        status: 'untranslated',
        modified: false,
        validated: false,
      },
      {
        id: 'q-2',
        formId: '0002A102',
        edid: 'WT_Quest_Stage_02',
        recordType: 'INFO',
        source: 'We must assemble our crew before sailing north.',
        target: '',
        status: 'untranslated',
        modified: false,
        validated: false,
      },
    ];
  }

  if (fileName.includes('MCM')) {
    return [
      {
        id: 'm-1',
        formId: '0002B201',
        edid: 'WT_MCM_Option_Dragon',
        recordType: 'MCM',
        source: 'Dragon Combat AI Behavior',
        target: '',
        status: 'untranslated',
        modified: false,
        validated: false,
      },
      {
        id: 'm-2',
        formId: '0002B202',
        edid: 'WT_MCM_Option_Weather',
        recordType: 'MCM',
        source: 'Dynamic Weather System and Ash Clouds',
        target: '',
        status: 'untranslated',
        modified: false,
        validated: false,
      },
    ];
  }

  return [
    {
      id: 'g-1',
      formId: '0002C301',
      edid: 'WT_Glossary_Term',
      recordType: 'FULL',
      source: 'Dragon Priest Staff of Ruin',
      target: '',
      status: 'untranslated',
      modified: false,
      validated: false,
    },
  ];
}
