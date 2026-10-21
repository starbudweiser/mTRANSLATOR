/**
 * Modal de Comparaison de Versions (Diff) pour mTRANSLATOR
 * Permet de repérer les nouvelles chaînes lors d'une mise à jour de mod Bethesda.
 */

import React, { useState } from 'react';
import { X, GitCompare, Plus, CheckCircle2, ArrowRight, RefreshCw } from 'lucide-react';
import { ModRecord } from '../types';
import { L } from '../i18n/L';

interface DiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRecords: ModRecord[];
  onMergeNewRecords: (newRecords: ModRecord[]) => void;
}

export const DiffModal: React.FC<DiffModalProps> = ({
  isOpen,
  onClose,
  currentRecords,
  onMergeNewRecords,
}) => {
  const [diffApplied, setDiffApplied] = useState(false);

  if (!isOpen) return null;

  // Données de mise à jour simulée (ex: Mod version 1.30 avec 2 nouvelles quêtes et 1 dialogue modifié)
  const simulatedNewVersion: Array<{
    type: 'new' | 'modified' | 'identical';
    formId: string;
    recordType: string;
    source: string;
    statusText: string;
  }> = [
    {
      type: 'new',
      formId: '0001D410',
      recordType: 'QUST',
      source: 'Investigate the rumblings beneath the frozen peak of Mount Wyrm.',
      statusText: L("Nouvelle quête v1.30 (Ajout)"),
    },
    {
      type: 'new',
      formId: '0001D411',
      recordType: 'WEAP',
      source: 'Runed Nordic War Pick',
      statusText: 'Nouvelle arme (Ajout)',
    },
    {
      type: 'modified',
      formId: '0001D404',
      recordType: 'DIAL',
      source: 'The winds around Wyrmstooth Island are cursed. No normal boat can cross without magical warding and a skilled helmsman.',
      statusText: L("Texte source révisé par l'auteur"),
    },
  ];

  const handleApplyMerge = () => {
    const recordsToAdd: ModRecord[] = [
      {
        id: `rec-v13-${Date.now()}-1`,
        formId: '0001D410',
        edid: 'WT_Quest_FrozenPeak',
        recordType: 'QUST',
        source: 'Investigate the rumblings beneath the frozen peak of Mount Wyrm.',
        target: '',
        status: 'untranslated',
        modified: true,
        validated: false,
      },
      {
        id: `rec-v13-${Date.now()}-2`,
        formId: '0001D411',
        edid: 'WT_Weap_RunedPick',
        recordType: 'WEAP',
        source: 'Runed Nordic War Pick',
        target: '',
        status: 'untranslated',
        modified: true,
        validated: false,
      },
    ];

    onMergeNewRecords(recordsToAdd);
    setDiffApplied(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-4 text-xs select-none">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-md shadow-2xl w-full max-w-2xl flex flex-col h-[500px] overflow-hidden text-[#dddddd]">
        {/* En-tête */}
        <div className="h-10 bg-[#262626] border-b border-[#333333] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <GitCompare className="w-4 h-4 text-[#f87171]" />
            <span className="font-semibold text-white">{L("Comparateur Diff de Versions de Mod")}</span>
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
        <div className="p-4 space-y-3 flex-1 flex flex-col overflow-hidden">
          <p className="text-[13px] text-[#aaaaaa]">{L("Comparez le mod chargé avec une nouvelle version (ESP / ESM) pour identifier instantanément les lignes ajoutées ou réécrites par l'auteur.")}</p>

          <div className="flex-1 overflow-auto border border-[#333333] rounded bg-[#181818] custom-scrollbar">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-[#222222] border-b border-[#333333] text-[#aaaaaa] text-[13px]">
                <tr>
                  <th className="px-3 py-2 w-24">FormID</th>
                  <th className="px-3 py-2 w-20">Type</th>
                  <th className="px-3 py-2">{L("Texte de la nouvelle version")}</th>
                  <th className="px-3 py-2 w-48">{L("Différence détectée")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2e2e2e]">
                {simulatedNewVersion.map((item, idx) => (
                  <tr key={idx} className="hover:bg-[#1e1e1e]">
                    <td className="px-3 py-2 font-mono text-[#38bdf8]">
                      {item.formId}
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px]">
                      {item.recordType}
                    </td>
                    <td className="px-3 py-2 text-[#ffffff]">
                      {item.source}
                    </td>
                    <td className="px-3 py-2">
                      {item.type === 'new' ? (
                        <span className="px-2 py-0.5 rounded bg-[#262626] text-[#4ade80] border border-[#22c55e] font-medium text-[12px] inline-flex items-center space-x-1">
                          <Plus className="w-2.5 h-2.5" />
                          <span>{item.statusText}</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-[#3f2a0c] text-[#fbbf24] border border-[#f59e0b] font-medium text-[12px] inline-flex items-center space-x-1">
                          <RefreshCw className="w-2.5 h-2.5" />
                          <span>{item.statusText}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {diffApplied && (
            <div className="p-2.5 bg-[#2c2c2c] border border-[#22c55e] rounded text-[#86efac] flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-[#4ade80]" />
              <span>{L("Les 2 nouvelles chaînes ont été injectées dans le projet actif !")}</span>
            </div>
          )}
        </div>

        {/* Pied de page */}
        <div className="h-12 bg-[#1e1e1e] border-t border-[#333333] px-4 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-[#2c2c2c] hover:bg-[#404040] text-white rounded transition-colors"
          >{L("Fermer")}</button>

          <button
            type="button"
            onClick={handleApplyMerge}
            disabled={diffApplied}
            className="px-4 py-1.5 bg-[#ef4444] hover:bg-[#ef4444] text-white font-medium rounded transition-colors flex items-center space-x-1.5 disabled:opacity-50"
          >
            <span>{L("Fusionner les nouvelles lignes (")}{simulatedNewVersion.filter(i => i.type === 'new').length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
