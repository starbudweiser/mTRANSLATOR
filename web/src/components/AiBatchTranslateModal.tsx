/**
 * Traduction automatique des lignes non traduites : Google gratuit (sans clé) ou Gemini (clé API).
 * Les balises Bethesda (<Alias>, %s, [pagebreak]…) sont protégées côté serveur.
 */

import React, { useState } from 'react';
import { X, Sparkles, AlertCircle, CheckCircle2, ShieldAlert, Play, RefreshCw, AlertTriangle, BookOpen } from 'lucide-react';
import { ModRecord, GameEngine, DictionaryEntry } from '../types';
import { translateFallbackText } from '../data/dictionaryHeuristics';
import { sanitizeBethesdaTranslation } from '../utils/translatorUtils';
import { useI18n } from '../i18n/LanguageContext';
import { translateBatch, getAiEngine, engineLabel } from '../utils/aiEngine';
import { EngineSettings } from './EngineSettings';

interface AiBatchTranslateModalProps {
  isOpen: boolean;
  onClose: () => void;
  untranslatedRecords: ModRecord[];
  game: GameEngine;
  dictionaries?: DictionaryEntry[];
  onApplyBatchTranslations: (translations: Array<{ id: string; translatedText: string }>) => void;
}

export const AiBatchTranslateModal: React.FC<AiBatchTranslateModalProps> = ({
  isOpen,
  onClose,
  untranslatedRecords,
  game,
  dictionaries = [],
  onApplyBatchTranslations,
}) => {
  const { t, targetLang, sourceLang } = useI18n();
  const [scope, setScope] = useState<'all_untranslated' | 'first_50' | 'first_100' | 'first_250'>('all_untranslated');
  const [batchSize, setBatchSize] = useState<number>(80);
  const [useFastPrePass, setUseFastPrePass] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Préparation des lots...');
  const [liveSpeed, setLiveSpeed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const targetRecords = 
    scope === 'first_50' 
      ? untranslatedRecords.slice(0, 50) 
      : scope === 'first_100' 
      ? untranslatedRecords.slice(0, 100) 
      : scope === 'first_250' 
      ? untranslatedRecords.slice(0, 250) 
      : untranslatedRecords;

  const handleStartTranslation = async () => {
    if (targetRecords.length === 0) {
      setError('Aucun enregistrement à traduire dans ce périmètre.');
      return;
    }

    setIsLoading(true);
    setProgress(5);
    setStatusText('Indexation et déduplication des chaînes...');
    setLiveSpeed(null);
    setError(null);
    setResultMessage(null);
    setWarningMessage(null);
    const startTime = Date.now();

    // Laisser le temps à React de rafraîchir l'interface immédiatement
    await new Promise((resolve) => setTimeout(resolve, 25));

    const allResults: Array<{ id: string; translatedText: string }> = [];

    try {
      const recordsToTranslateAi: ModRecord[] = [];
      let fastMatchCount = 0;

      // 1. Pré-passe ultra-rapide (0ms) : Dictionnaires SST & Lexique local Bethesda
      const dictMap = new Map<string, string>();
      for (const d of dictionaries) {
        if (d && d.source && d.target) {
          dictMap.set(d.source.toLowerCase().trim(), d.target);
        }
      }

      const sourceMap = new Map<string, string>();
      targetRecords.forEach((r) => sourceMap.set(String(r.id), r.source || ''));

      if (useFastPrePass) {
        for (const r of targetRecords) {
          const lower = (r.source || '').toLowerCase().trim();
          if (dictMap.has(lower)) {
            allResults.push({
              id: String(r.id),
              translatedText: sanitizeBethesdaTranslation(dictMap.get(lower)!, r.source || ''),
            });
            fastMatchCount++;
          } else {
            recordsToTranslateAi.push(r);
          }
        }
      } else {
        recordsToTranslateAi.push(...targetRecords);
      }

      // Si tout a été résolu par les glossaires locaux, application instantanée sans attente réseau
      if (recordsToTranslateAi.length === 0) {
        onApplyBatchTranslations(allResults);
        setProgress(100);
        setStatusText('Terminé instantanément via glossaire');
        setResultMessage(`${allResults.length} chaînes traduites instantanément via le glossaire SST Bethesda !`);
        setIsLoading(false);
        return;
      }

      // Application immédiate des correspondances SST en base pour voir les lignes validées dès la seconde 0
      if (allResults.length > 0) {
        onApplyBatchTranslations(allResults);
      }

      // 2. Déduplication des chaînes identiques pour économiser 50% à 70% de temps et de tokens
      const uniqueSourceToIds = new Map<string, string[]>();
      const uniqueItems: Array<{ id: string; text: string; context: string }> = [];

      for (const r of recordsToTranslateAi) {
        const textKey = r.source || '';
        const recId = String(r.id);
        if (!uniqueSourceToIds.has(textKey)) {
          uniqueSourceToIds.set(textKey, [recId]);
          uniqueItems.push({
            id: recId,
            text: textKey,
            context: `Type: ${r.recordType || 'TEXT'}, FormID: ${r.formId || '00000000'}`,
          });
        } else {
          uniqueSourceToIds.get(textKey)!.push(recId);
        }
      }

      // 3. Découpage adaptatif intelligent par budget de caractères
      // - Petites chaînes (<150 car) : jusqu'à 30 chaînes par sous-lot (~2500 car max)
      // - Livres et textes longs (>1000 car) : 1 ou 2 par sous-lot pour éliminer tout risque de timeout
      const maxCharBudget = batchSize === 50 ? 2500 : batchSize === 120 ? 4200 : 3200;
      const maxItemBudget = batchSize === 50 ? 20 : batchSize === 120 ? 45 : 30;

      const chunks: Array<Array<{ id: string; text: string; context: string }>> = [];
      let currentChunk: Array<{ id: string; text: string; context: string }> = [];
      let currentChars = 0;

      for (const item of uniqueItems) {
        const itemLen = item.text.length;
        if (
          currentChunk.length > 0 &&
          (currentChars + itemLen > maxCharBudget || currentChunk.length >= maxItemBudget)
        ) {
          chunks.push(currentChunk);
          currentChunk = [];
          currentChars = 0;
        }
        currentChunk.push(item);
        currentChars += itemLen;
      }
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }

      let usedEngineName = engineLabel(getAiEngine());
      let hadWarning: string | null = null;
      let translatedUniqueCount = 0;

      // Traitement parallèle 2 par 2 pour diviser le temps d'attente par 2
      const CONCURRENCY = 2;
      const totalBatches = Math.ceil(chunks.length / CONCURRENCY);

      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const slice = chunks.slice(i, i + CONCURRENCY);
        const batchNum = Math.floor(i / CONCURRENCY) + 1;
        const currentBatchItems = slice.reduce((sum, c) => sum + c.length, 0);

        // Mettre à jour l'affichage IMMÉDIATEMENT avant de lancer l'appel réseau
        setStatusText(`⚡ Lot ${batchNum}/${totalBatches} (${currentBatchItems} chaînes) en cours via ${usedEngineName}...`);
        const currentProgress = Math.max(10, Math.min(95, Math.round(10 + (translatedUniqueCount / Math.max(1, uniqueItems.length)) * 85)));
        setProgress(currentProgress);
        
        const chunkPromises = slice.map(async (chunk) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000);
          try {
            const data = await translateBatch(
              chunk.map(({ id, text }) => ({ id, text })),
              { targetLang: targetLang || 'Français', game, signal: controller.signal },
            );
            if (data.engine) usedEngineName = data.engine;
            if (data.warning) hadWarning = data.warning;
            return data.translations;
          } catch (fetchErr: any) {
            console.warn('[Traduction par lot] Avertissement réseau pour le lot:', fetchErr?.message || fetchErr);
            hadWarning = 'Délai réseau dépassé pour un sous-lot : repli automatique ponctuel.';
          } finally {
            clearTimeout(timeoutId);
          }

          // Fallback de secours ponctuel pour CE sous-lot uniquement
          return chunk.map((item) => ({
            id: String(item.id),
            translatedText: sanitizeBethesdaTranslation(translateFallbackText(item.text), item.text),
          }));
        });

        const batchResults = await Promise.all(chunkPromises);
        const batchNewTranslations: Array<{ id: string; translatedText: string }> = [];

        for (const resList of batchResults) {
          for (const t of resList) {
            const strId = String(t.id);
            const src = sourceMap.get(strId) || '';
            const cleanTrans = sanitizeBethesdaTranslation(t.translatedText, src);
            const matchingIds = uniqueSourceToIds.get(src) || [strId];
            for (const targetId of matchingIds) {
              const itemResult = {
                id: targetId,
                translatedText: cleanTrans,
              };
              allResults.push(itemResult);
              batchNewTranslations.push(itemResult);
            }
            translatedUniqueCount++;
          }
        }

        // APPLICATION PROGRESSIVE EN TEMPS RÉEL : Les lignes traduites s'affichent immédiatement en vert !
        if (batchNewTranslations.length > 0) {
          onApplyBatchTranslations(batchNewTranslations);
        }

        const elapsedSec = Math.max(0.5, (Date.now() - startTime) / 1000);
        const currentSpeed = Math.round(allResults.length / elapsedSec);
        setLiveSpeed(currentSpeed);

        const chunkPercent = Math.min(95, Math.round(10 + ((translatedUniqueCount / uniqueItems.length) * 85)));
        setProgress(chunkPercent);
        setStatusText(`⚡ Vitesse : ~${currentSpeed} chaînes/sec (${allResults.length}/${targetRecords.length})...`);
      }

      setProgress(100);
      const totalElapsedSec = Math.max(1, ((Date.now() - startTime) / 1000)).toFixed(1);
      const finalSpeed = Math.round(allResults.length / parseFloat(totalElapsedSec));
      setStatusText(`Traduction terminée en ${totalElapsedSec}s (~${finalSpeed} chaînes/sec)`);

      if (hadWarning) {
        setWarningMessage(hadWarning);
      }
      
      const fastNotice = fastMatchCount > 0 ? ` (${fastMatchCount} résolues instantanément par le glossaire)` : '';
      setResultMessage(`${allResults.length} chaînes intégrées en ${totalElapsedSec}s via ${usedEngineName}${fastNotice} !`);
    } catch (err: any) {
      console.error('[Erreur traduction par lot]:', err);
      setWarningMessage('Une interruption est survenue. Les chaînes déjà traduites ont été enregistrées avec succès.');
      setResultMessage(`${allResults.length || 0} chaînes traduites et conservées.`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-[2px] p-4 text-xs select-none">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-md shadow-2xl w-full max-w-xl flex flex-col overflow-hidden text-[#dddddd]">
        {/* En-tête */}
        <div className="h-10 bg-[#262626] border-b border-[#333333] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#fbbf24]" />
            <span className="font-semibold text-white">
              Traduction automatique
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#0369a1]/20 text-[#38bdf8] text-[10px] font-mono border border-[#0369a1]/40">
              {sourceLang} ➔ {targetLang}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#aaaaaa] hover:text-white p-1 rounded hover:bg-[#303030]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corps */}
        <div className="p-4 space-y-3.5">
          {/* Moteur de traduction */}
          <div className="space-y-1.5">
            <label className="font-medium text-[#dddddd] block">Moteur de traduction :</label>
            <EngineSettings disabled={isLoading} />
          </div>

          {/* Option Turbo : Pré-résolution locale & Débit des lots */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 bg-[#1a1a1a] border border-[#0369a1] rounded flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-[#38bdf8] shrink-0" />
                <div>
                  <span className="font-semibold text-[#ffffff] text-[11px] block">
                    Pré-passe Glossaire SST
                  </span>
                  <span className="text-[9px] text-[#aaaaaa] block">
                    0ms pour termes déjà connus
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useFastPrePass}
                  onChange={(e) => setUseFastPrePass(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-8 h-4 bg-[#333333] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#0369a1]"></div>
              </label>
            </div>

            <div className="p-2.5 bg-[#181818] border border-[#2e2e2e] rounded flex items-center justify-between">
              <div>
                <span className="font-semibold text-[#ffffff] text-[11px] block">
                  Budget adaptatif
                </span>
                <span className="text-[9px] text-[#aaaaaa] block">
                  Spécial gros mods &amp; livres
                </span>
              </div>
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="bg-[#222222] border border-[#444444] rounded px-2 py-1 text-[#ffffff] text-[11px] outline-none"
              >
                <option value={80}>Adaptatif (Recommandé)</option>
                <option value={50}>Prudent (Livres volumineux)</option>
                <option value={120}>Turbo (Chaînes courtes)</option>
              </select>
            </div>
          </div>

          {/* Règles de préservation des balises */}
          <div className="p-2.5 bg-[#181818] border border-[#2e2e2e] rounded flex items-start space-x-2.5">
            <ShieldAlert className="w-4 h-4 text-[#38bdf8] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold text-[#ffffff] text-[11px] block">
                Protection stricte des balises Bethesda &amp; Livres
              </span>
              <p className="text-[10px] text-[#aaaaaa] leading-relaxed">
                Préservation garantie des balises <code className="text-[#38bdf8]">&lt;Alias=...&gt;</code>,
                variables <code className="text-[#38bdf8]">%s, %d</code> et verrouillage absolu du mot-clé de pagination{' '}
                <code className="bg-[#3f2a0c] text-[#fde68a] px-1 py-0.2 rounded font-mono">[pagebreak]</code>.
              </p>
            </div>
          </div>

          {/* Sélection du périmètre */}
          <div className="space-y-1.5">
            <label className="font-medium text-[#dddddd] block">
              Périmètre à traduire :
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => setScope('all_untranslated')}
                className={`p-2 rounded border text-left transition-colors ${
                  scope === 'all_untranslated'
                    ? 'bg-[#262626] border-[#38bdf8] text-white'
                    : 'bg-[#181818] border-[#2e2e2e] text-[#aaaaaa] hover:bg-[#262626]'
                }`}
              >
                <span className="font-semibold block truncate">Toutes</span>
                <span className="text-[9px] text-[#666666]">{untranslatedRecords.length} élément(s)</span>
              </button>

              <button
                type="button"
                onClick={() => setScope('first_50')}
                className={`p-2 rounded border text-left transition-colors ${
                  scope === 'first_50'
                    ? 'bg-[#262626] border-[#38bdf8] text-white'
                    : 'bg-[#181818] border-[#2e2e2e] text-[#aaaaaa] hover:bg-[#262626]'
                }`}
              >
                <span className="font-semibold block truncate">50 premières</span>
                <span className="text-[9px] text-[#666666]">Échantillon</span>
              </button>

              <button
                type="button"
                onClick={() => setScope('first_100')}
                className={`p-2 rounded border text-left transition-colors ${
                  scope === 'first_100'
                    ? 'bg-[#262626] border-[#38bdf8] text-white'
                    : 'bg-[#181818] border-[#2e2e2e] text-[#aaaaaa] hover:bg-[#262626]'
                }`}
              >
                <span className="font-semibold block truncate">100 premières</span>
                <span className="text-[9px] text-[#666666]">Lot moyen</span>
              </button>

              <button
                type="button"
                onClick={() => setScope('first_250')}
                className={`p-2 rounded border text-left transition-colors ${
                  scope === 'first_250'
                    ? 'bg-[#262626] border-[#38bdf8] text-white'
                    : 'bg-[#181818] border-[#2e2e2e] text-[#aaaaaa] hover:bg-[#262626]'
                }`}
              >
                <span className="font-semibold block truncate">250 premières</span>
                <span className="text-[9px] text-[#666666]">Gros volume</span>
              </button>
            </div>
          </div>

          {/* Profil de jeu */}
          <div className="flex items-center justify-between p-2 bg-[#181818] border border-[#2e2e2e] rounded text-[11px]">
            <span className="text-[#aaaaaa]">Univers / Contexte de jeu :</span>
            <span className="font-medium text-[#ffffff]">{game}</span>
          </div>

          {/* Barre de progression pendant l'appel */}
          {isLoading && (
            <div className="space-y-1.5 py-1">
              <div className="flex items-center justify-between text-[11px] text-[#aaaaaa]">
                <span className="flex items-center space-x-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-[#fbbf24] animate-spin" />
                  <span>{statusText}</span>
                </span>
                <span className="font-mono text-[#38bdf8]">{progress}%</span>
              </div>
              <div className="w-full bg-[#181818] h-2 rounded-full overflow-hidden border border-[#2e2e2e]">
                <div 
                  className="bg-gradient-to-r from-[#f59e0b] via-[#0369a1] to-[#22c55e] h-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Message de succès */}
          {resultMessage && (
            <div className="p-2.5 bg-[#262626] border border-[#22c55e] rounded text-[#86efac] flex items-center space-x-2 text-[11px]">
              <CheckCircle2 className="w-4 h-4 text-[#4ade80] shrink-0" />
              <span>{resultMessage}</span>
            </div>
          )}

          {/* Message d'avertissement fallback */}
          {warningMessage && (
            <div className="p-2.5 bg-[#1e1e1e] border border-[#f59e0b] rounded text-[#fbbf24] flex items-start space-x-2 text-[11px]">
              <AlertTriangle className="w-4 h-4 text-[#fbbf24] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-semibold block">Mode Secours Actif</span>
                <p className="leading-relaxed text-[#fde68a]">{warningMessage}</p>
              </div>
            </div>
          )}

          {/* Message d'erreur */}
          {error && (
            <div className="p-2.5 bg-[#1e1e1e] border border-[#ef4444] rounded text-[#fecaca] flex items-start space-x-2 text-[11px]">
              <AlertCircle className="w-4 h-4 text-[#f87171] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-semibold block">Erreur de traduction</span>
                <p className="leading-relaxed">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Pied de page */}
        <div className="h-12 bg-[#1e1e1e] border-t border-[#333333] px-4 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-[#2c2c2c] hover:bg-[#404040] text-white rounded transition-colors"
          >
            Fermer
          </button>

          <button
            type="button"
            onClick={handleStartTranslation}
            disabled={isLoading || targetRecords.length === 0}
            className="px-4 py-1.5 bg-[#f59e0b] hover:bg-[#d97706] text-black font-semibold rounded transition-colors flex items-center space-x-1.5 disabled:opacity-50 shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Lancer la traduction ({targetRecords.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
};

