/**
 * Outil de Recherche & Remplacement par lot pour mTRANSLATOR macOS
 * Prise en charge des expressions régulières (Regex), du respect de la casse et du ciblage VO/VF.
 */

import React, { useState } from 'react';
import { X, SlidersHorizontal, Check, AlertCircle } from 'lucide-react';
import { ModRecord } from '../types';

interface FindReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: ModRecord[];
  onBatchReplace: (
    findText: string,
    replaceText: string,
    options: {
      targetField: 'target' | 'source';
      useRegex: boolean;
      caseSensitive: boolean;
    }
  ) => { replacedCount: number };
}

export const FindReplaceModal: React.FC<FindReplaceModalProps> = ({
  isOpen,
  onClose,
  records,
  onBatchReplace,
}) => {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [targetField, setTargetField] = useState<'target' | 'source'>('target');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [regexError, setRegexError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExecuteReplace = () => {
    if (!findText) return;

    if (useRegex) {
      try {
        new RegExp(findText);
      } catch (err: any) {
        setRegexError(`Erreur d'expression régulière : ${err.message}`);
        return;
      }
    }
    setRegexError(null);

    const result = onBatchReplace(findText, replaceText, {
      targetField,
      useRegex,
      caseSensitive,
    });

    setResultMessage(`${result.replacedCount} occurrence(s) remplacée(s) dans les chaînes de traduction.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-4 text-xs select-none">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-md shadow-2xl w-full max-w-lg flex flex-col overflow-hidden text-[#dddddd]">
        {/* En-tête */}
        <div className="h-10 bg-[#262626] border-b border-[#333333] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <SlidersHorizontal className="w-4 h-4 text-[#4ade80]" />
            <span className="font-semibold text-white">
              Rechercher & Remplacer par lot
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

        {/* Corps du formulaire */}
        <div className="p-4 space-y-3.5">
          {/* Champ Rechercher */}
          <div className="space-y-1">
            <label className="font-medium text-[#dddddd] block">Rechercher :</label>
            <input
              type="text"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              placeholder="Texte ou motif Regex..."
              className="w-full bg-[#181818] text-[#ffffff] px-3 py-1.5 rounded border border-[#333333] focus:outline-none focus:border-[#22c55e]"
            />
          </div>

          {/* Champ Remplacer par */}
          <div className="space-y-1">
            <label className="font-medium text-[#dddddd] block">Remplacer par :</label>
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="Texte de remplacement..."
              className="w-full bg-[#181818] text-[#ffffff] px-3 py-1.5 rounded border border-[#333333] focus:outline-none focus:border-[#22c55e]"
            />
          </div>

          {/* Options de ciblage */}
          <div className="p-3 bg-[#181818] border border-[#2e2e2e] rounded space-y-2.5">
            <div className="flex items-center space-x-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="targetField"
                  checked={targetField === 'target'}
                  onChange={() => setTargetField('target')}
                  className="accent-[#22c55e]"
                />
                <span>Dans la Traduction (VF)</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="targetField"
                  checked={targetField === 'source'}
                  onChange={() => setTargetField('source')}
                  className="accent-[#22c55e]"
                />
                <span>Dans l&apos;Original (VO)</span>
              </label>
            </div>

            <div className="flex items-center space-x-4 pt-1 border-t border-[#2e2e2e]">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  className="accent-[#22c55e]"
                />
                <span>Respecter la casse</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRegex}
                  onChange={(e) => setUseRegex(e.target.checked)}
                  className="accent-[#22c55e]"
                />
                <span>Expression régulière (Regex)</span>
              </label>
            </div>
          </div>

          {/* Erreur Regex */}
          {regexError && (
            <div className="p-2.5 bg-[#1e1e1e] border border-[#ef4444] rounded text-[#fecaca] flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-[#f87171] shrink-0" />
              <span>{regexError}</span>
            </div>
          )}

          {/* Message de confirmation */}
          {resultMessage && (
            <div className="p-2.5 bg-[#262626] border border-[#22c55e] rounded text-[#86efac] flex items-center space-x-2">
              <Check className="w-4 h-4 text-[#4ade80] shrink-0" />
              <span>{resultMessage}</span>
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
            onClick={handleExecuteReplace}
            disabled={!findText}
            className="px-4 py-1.5 bg-[#22c55e] hover:bg-[#22c55e] text-white font-medium rounded transition-colors disabled:opacity-50"
          >
            Remplacer tout
          </button>
        </div>
      </div>
    </div>
  );
};
