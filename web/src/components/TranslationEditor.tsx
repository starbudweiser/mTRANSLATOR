/**
 * Éditeur de traduction mTRANSLATOR (Volet inférieur / Split view)
 * Affiche la chaîne source, la zone d'édition avec validation des balises en temps réel,
 * et les suggestions de mémoire de traduction SST / IA.
 */

import React, { useState, useEffect } from 'react';
import { ModRecord, DictionaryEntry } from '../types';
import { 
  Copy, 
  Sparkles, 
  Check, 
  AlertTriangle, 
  RotateCcw, 
  BookMarked, 
  Tag, 
  ArrowRight,
  CheckCircle2,
  Code2,
  BookOpen,
  Zap,
  Info
} from 'lucide-react';
import { validateTags, extractBethesdaTags, sanitizeBethesdaTranslation } from '../utils/translatorUtils';
import { getRecordDiagnostic } from '../utils/recordDiagnostics';
import { useI18n } from '../i18n/LanguageContext';

interface TranslationEditorProps {
  record: ModRecord | null;
  dictionaries?: DictionaryEntry[];
  onUpdateTarget: (recordId: string, newTarget: string, autoValidate?: boolean) => void;
  onValidate: (recordId: string) => void;
  onMarkIdentical: (recordId: string) => void;
  onTranslateSingleWithAi: (record: ModRecord) => Promise<string | null>;
  onNextUntranslated: () => void;
  onPrevRecord: () => void;
  onNextRecord: () => void;
}

export const TranslationEditor: React.FC<TranslationEditorProps> = ({
  record,
  dictionaries = [],
  onUpdateTarget,
  onValidate,
  onMarkIdentical,
  onTranslateSingleWithAi,
  onNextUntranslated,
  onPrevRecord,
  onNextRecord,
}) => {
  const { t, targetLang } = useI18n();
  const [targetText, setTargetText] = useState('');
  const [isTranslatingAi, setIsTranslatingAi] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Synchronise le texte cible lorsque l'enregistrement sélectionné change
  useEffect(() => {
    if (record) {
      setTargetText(record.target || '');
      setWarnings(validateTags(record.source, record.target || ''));
    } else {
      setTargetText('');
      setWarnings([]);
    }
  }, [record]);

  if (!record) {
    return (
      <div className="h-64 bg-[#1a1a1a] border-t border-[#333333] flex items-center justify-center text-[#666666] select-none text-xs">
        Sélectionnez une chaîne dans la liste ci-dessus pour afficher et modifier la traduction.
      </div>
    );
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setTargetText(val);
    const newWarnings = validateTags(record.source, val);
    setWarnings(newWarnings);
    onUpdateTarget(record.id, val, false);
  };

  const handleCopySource = () => {
    const textToCopy = record.source.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
    setTargetText(textToCopy);
    setWarnings(validateTags(record.source, textToCopy));
    onUpdateTarget(record.id, textToCopy, false);
  };

  const handleTranslateAiClick = async () => {
    setIsTranslatingAi(true);
    try {
      const translated = await onTranslateSingleWithAi(record);
      if (translated) {
        setTargetText(translated);
        setWarnings(validateTags(record.source, translated));
        onUpdateTarget(record.id, translated, false);
      }
    } finally {
      setIsTranslatingAi(false);
    }
  };

  const handleApplyDictionary = (suggested: string) => {
    setTargetText(suggested);
    setWarnings(validateTags(record.source, suggested));
    onUpdateTarget(record.id, suggested, true);
  };

  const handleInsertTag = (tag: string) => {
    const updated = targetText ? `${targetText} ${tag}` : tag;
    setTargetText(updated);
    setWarnings(validateTags(record.source, updated));
    onUpdateTarget(record.id, updated, false);
  };

  const sourceTags = extractBethesdaTags(record.source);
  const sourceWordCount = record.source.trim().split(/\s+/).filter(Boolean).length;
  const targetWordCount = targetText.trim().split(/\s+/).filter(Boolean).length;
  const diag = getRecordDiagnostic(record, dictionaries);

  const availableSuggestion = diag.suggestion || record.dictionaryMatch;
  const suggestionScore = diag.score || record.fuzzyMatch || 100;

  return (
    <div className="h-72 bg-[#1a1a1a] border-t border-[#333333] flex flex-col text-xs select-none">
      {/* Barre d'en-tête de l'éditeur */}
      <div className="h-8 bg-[#222222] border-b border-[#333333] px-3 flex items-center justify-between text-[#aaaaaa]">
        <div className="flex items-center space-x-2.5">
          <span className="font-mono text-[#38bdf8] font-medium">
            FormID: {record.formId}
          </span>
          <span className="text-[#666666]">|</span>
          <span className="font-mono text-[#aaaaaa]">
            EDID: {record.edid || 'Aucun'}
          </span>
          <span className="text-[#666666]">|</span>
          <span className="px-1.5 py-0.5 rounded bg-[#2c2c2c] text-[10px] text-[#dddddd] font-mono">
            {record.recordType}
          </span>
          <span className="text-[#666666]">|</span>
          <span 
            className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center space-x-1 ${diag.badgeClass}`}
            title={diag.detailedReason}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: diag.dotColor }} />
            <span>{diag.shortLabel}</span>
          </span>
        </div>

        {/* Boutons de navigation précédent / suivant */}
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={onPrevRecord}
            className="px-2 py-0.5 bg-[#2c2c2c] hover:bg-[#333333] text-[#dddddd] border border-[#444444] rounded text-[11px]"
            title="Enregistrement précédent (Flèche Haut)"
          >
            ▲ Préc.
          </button>
          <button
            type="button"
            onClick={onNextRecord}
            className="px-2 py-0.5 bg-[#2c2c2c] hover:bg-[#333333] text-[#dddddd] border border-[#444444] rounded text-[11px]"
            title="Enregistrement suivant (Flèche Bas)"
          >
            ▼ Suiv.
          </button>
        </div>
      </div>

      {/* Corps de l'éditeur (Division Source / Cible + Volet Dictionnaire) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Panneau Texte Original (VO) */}
        <div className="w-1/2 border-r border-[#333333] flex flex-col bg-[#181818]">
          <div className="px-3 py-1.5 bg-[#1e1e1e] border-b border-[#2e2e2e] flex items-center justify-between text-[#aaaaaa]">
            <span className="font-medium text-[#dddddd]">Source Originale (VO)</span>
            <div className="flex items-center space-x-2 text-[11px]">
              <span>{record.source.length} car.</span>
              <span>•</span>
              <span>{sourceWordCount} mots</span>
              <button
                type="button"
                onClick={handleCopySource}
                className="flex items-center space-x-1 px-1.5 py-0.5 bg-[#2c2c2c] hover:bg-[#333333] text-[#38bdf8] border border-[#444444] rounded transition-colors"
                title="Copier la source dans la traduction"
              >
                <Copy className="w-3 h-3" />
                <span>Copier</span>
              </button>
            </div>
          </div>

          <div className="flex-1 p-3 overflow-y-auto text-[13px] font-sans leading-relaxed text-[#ffffff] select-text custom-scrollbar whitespace-pre-wrap">
            {record.source.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')}
          </div>

          {/* Liste des balises détectées dans la source */}
          {sourceTags.length > 0 && (
            <div className="px-3 py-1.5 bg-[#181818] border-t border-[#2e2e2e] flex items-center space-x-1.5 overflow-x-auto text-[11px]">
              <span className="text-[#666666] flex items-center space-x-1 whitespace-nowrap">
                <Code2 className="w-3 h-3" />
                <span>Balises :</span>
              </span>
              {sourceTags.map((tag, idx) => {
                const isPagebreak = /pagebreak/i.test(tag);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleInsertTag(tag)}
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap flex items-center space-x-1 transition-colors ${
                      isPagebreak
                        ? 'bg-[#3f2a0c] hover:bg-[#3f2a0c] text-[#fbbf24] border-[#f59e0b]'
                        : 'bg-[#262626] hover:bg-[#404040] text-[#38bdf8] border-[#444444]'
                    }`}
                    title={isPagebreak ? 'Saut de page de livre (Cliquer pour insérer [pagebreak])' : 'Cliquer pour insérer dans la traduction'}
                  >
                    {isPagebreak && <BookOpen className="w-2.5 h-2.5 mr-0.5" />}
                    <span>{tag}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Panneau Traduction (VF) */}
        <div className="w-1/2 flex flex-col bg-[#1a1a1a]">
          <div className="px-3 py-1.5 bg-[#1e1e1e] border-b border-[#2e2e2e] flex items-center justify-between text-[#aaaaaa]">
            <span className="font-medium text-[#dddddd]">{t('editor.targetLabel', { lang: targetLang })}</span>
            <div className="flex items-center space-x-2 text-[11px]">
              <span>{targetText.length} car.</span>
              <span>•</span>
              <span>{targetWordCount} mots</span>
              {/* Bouton IA */}
              <button
                type="button"
                onClick={handleTranslateAiClick}
                disabled={isTranslatingAi}
                className="flex items-center space-x-1 px-2 py-0.5 bg-[#222222] hover:bg-[#303030] text-[#fbbf24] border border-[#f59e0b] rounded transition-colors disabled:opacity-50"
                title="Traduire cette ligne avec Gemini AI"
              >
                <Sparkles className="w-3 h-3" />
                <span>{isTranslatingAi ? 'Traduction...' : 'IA Gemini'}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 p-2 flex flex-col">
            <textarea
              value={targetText}
              onChange={handleTextChange}
              placeholder={t('editor.targetPlaceholder')}
              className="flex-1 w-full bg-[#181818] text-[#ffffff] p-2.5 rounded border border-[#333333] focus:outline-none focus:border-[#38bdf8] text-[13px] leading-relaxed resize-none custom-scrollbar"
            />
          </div>

          {/* Bandeau d'alerte balises */}
          {warnings.length > 0 && (
            <div className="px-3 py-1.5 bg-[#1e1e1e] border-t border-[#ef4444] flex items-center justify-between text-[11px] text-[#f87171]">
              <div className="flex items-center space-x-2 truncate">
                <AlertTriangle className="w-3.5 h-3.5 text-[#f87171] shrink-0" />
                <span className="truncate">{warnings[0]}</span>
              </div>
              {/* Correction 1-clic pour [pagebreak] si traduit ou altéré */}
              {/pagebreak/i.test(warnings[0]) && (
                <button
                  type="button"
                  onClick={() => {
                    const sanitized = sanitizeBethesdaTranslation(targetText, record.source);
                    setTargetText(sanitized);
                    setWarnings(validateTags(record.source, sanitized));
                    onUpdateTarget(record.id, sanitized, false);
                  }}
                  className="ml-2 px-2 py-0.5 bg-[#4a1c1c] hover:bg-[#4a1c1c] text-white rounded border border-[#ef4444] font-medium shrink-0"
                >
                  Rétablir [pagebreak]
                </button>
              )}
            </div>
          )}

          {/* Suggestion Dictionnaire SST / Mémoire Locale */}
          {availableSuggestion && (
            <div className={`px-3 py-1 border-t flex items-center justify-between text-[11px] ${
              diag.isLocalLearned 
                ? 'bg-[#222222] border-[#0369a1] text-[#38bdf8]' 
                : 'bg-[#1e1e1e] border-[#333333] text-[#4ade80]'
            }`}>
              <div className="flex items-center space-x-1.5 truncate">
                <BookMarked className={`w-3 h-3 shrink-0 ${diag.isLocalLearned ? 'text-[#38bdf8]' : 'text-[#4ade80]'}`} />
                <span className={`font-medium ${diag.isLocalLearned ? 'text-[#bae6fd]' : 'text-[#86efac]'}`}>
                  {diag.isLocalLearned ? `Mémoire Locale (${suggestionScore}%):` : `SST Match (${suggestionScore}%):`}
                </span>
                <span className="text-[#dddddd] truncate">{availableSuggestion}</span>
              </div>
              <button
                type="button"
                onClick={() => handleApplyDictionary(availableSuggestion)}
                className={`ml-2 px-2 py-0.5 rounded text-[10px] whitespace-nowrap flex items-center space-x-1 font-medium border ${
                  diag.isLocalLearned
                    ? 'bg-[#075985] hover:bg-[#0369a1] text-[#86efac] border-[#0ea5e9]'
                    : 'bg-[#333333] hover:bg-[#444444] text-[#86efac] border-[#22c55e]'
                }`}
              >
                <Zap className="w-2.5 h-2.5" />
                <span>Appliquer ({suggestionScore}%)</span>
              </button>
            </div>
          )}

          {/* Avis informatif si la ligne est inédite au mod */}
          {!targetText && !availableSuggestion && diag.reason === 'UNSEEN_MOD_TEXT' && (
            <div className="px-3 py-1 bg-[#181818] border-t border-[#0369a1] flex items-center justify-between text-[11px] text-[#38bdf8]">
              <div className="flex items-center space-x-1.5 truncate">
                <Sparkles className="w-3 h-3 text-[#38bdf8] shrink-0" />
                <span className="text-[#dddddd] font-medium">Texte inédit du mod :</span>
                <span className="text-[#38bdf8] truncate">Non répertorié dans les dictionnaires SST officiels.</span>
              </div>
              <button
                type="button"
                onClick={handleTranslateAiClick}
                disabled={isTranslatingAi}
                className="ml-2 px-2 py-0.5 bg-[#0c3a52] hover:bg-[#0c3a52] text-[#dddddd] border border-[#0369a1] rounded text-[10px] whitespace-nowrap flex items-center space-x-1"
              >
                <Sparkles className="w-2.5 h-2.5 text-[#38bdf8]" />
                <span>Traduire avec Gemini</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Barre d'action inférieure */}
      <div className="h-9 bg-[#1e1e1e] border-t border-[#333333] px-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {/* Marquer identique */}
          <button
            type="button"
            onClick={() => onMarkIdentical(record.id)}
            className="flex items-center space-x-1 px-2.5 py-1 bg-[#222222] hover:bg-[#303030] text-[#38bdf8] border border-[#333333] rounded transition-colors text-[11px]"
            title="Conserver le texte original comme traduction (nom propre lore, commande)"
          >
            <Tag className="w-3 h-3" />
            <span>Identique (Nom Propre)</span>
          </button>

          {/* Vider / Réinitialiser */}
          <button
            type="button"
            onClick={() => {
              setTargetText('');
              onUpdateTarget(record.id, '', false);
            }}
            className="flex items-center space-x-1 px-2 py-1 bg-[#222222] hover:bg-[#2c2c2c] text-[#aaaaaa] hover:text-white border border-[#333333] rounded transition-colors text-[11px]"
            title="Effacer la traduction"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Effacer</span>
          </button>
        </div>

        {/* Valider et Passer au suivant */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => onValidate(record.id)}
            className="flex items-center space-x-1 px-3 py-1 bg-[#2c2c2c] hover:bg-[#333333] text-[#4ade80] border border-[#444444] rounded font-medium transition-colors text-[11px]"
            title="Valider la ligne actuelle"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Valider</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onValidate(record.id);
              onNextUntranslated();
            }}
            className="flex items-center space-x-1.5 px-3 py-1 bg-[#0369a1] hover:bg-[#0369a1] text-white rounded font-medium transition-colors text-[11px] shadow-sm"
            title="Valider et sauter directement au prochain élément non-traduit (F10 / ⌘↵)"
          >
            <span>Valider & Suivant non-traduit</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
