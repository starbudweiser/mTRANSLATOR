/**
 * Modal de Statistiques et Rapport de Traduction mTRANSLATOR
 * Fournit une vue d'ensemble de la progression du projet et permet d'exporter un rapport texte.
 */

import React from 'react';
import { X, BarChart3, Download, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import { TranslationStats, ModFileMeta } from '../types';
import { triggerFileDownload } from '../utils/translatorUtils';
import { L } from '../i18n/L';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: TranslationStats;
  meta: ModFileMeta;
}

export const StatsModal: React.FC<StatsModalProps> = ({
  isOpen,
  onClose,
  stats,
  meta,
}) => {
  if (!isOpen) return null;

  const handleExportReport = () => {
    const report = L("=====================================================\nRAPPORT DE TRADUCTION - mTRANSLATOR\n=====================================================\nFichier : {fileName}\nJeu     : {game}\nFormat  : {fileType}\nDate    : {toLocaleString}\n=====================================================\n\nPROGRESSION GLOBALE :\n- Total d'enregistrements : {total}\n- Traduits et validés     : {translated} ({percentage}%)\n- Non traduits            : {untranslated}\n- En cours / Partiels     : {partial}\n- Identiques (Noms propres): {identical}\n- Alertes de balises      : {warningsCount}\n\nVOLUMÉTRIE DES MOTS :\n- Mots dans la source VO  : {wordCountSource}\n- Mots dans la cible VF   : {wordCountTarget}\n\nStatut du projet : {v}\n=====================================================\nGénéré par mTRANSLATOR Edition (Style Fusion Dossier)\n", { fileName: meta.fileName, game: meta.game, fileType: meta.fileType, toLocaleString: new Date().toLocaleString('fr-FR'), total: stats.total, translated: stats.translated, percentage: stats.percentage, untranslated: stats.untranslated, partial: stats.partial, identical: stats.identical, warningsCount: stats.warningsCount, wordCountSource: stats.wordCountSource, wordCountTarget: stats.wordCountTarget, v: stats.percentage === 100 ? 'COMPLET - Prêt pour l\'intégration' : 'EN COURS DE LOCALISATION' });
    triggerFileDownload(report, `Rapport_${meta.fileName}.txt`, 'text/plain;charset=utf-8');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-4 text-xs select-none">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-md shadow-2xl w-full max-w-lg flex flex-col overflow-hidden text-[#dddddd]">
        {/* En-tête */}
        <div className="h-10 bg-[#262626] border-b border-[#333333] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-[#38bdf8]" />
            <span className="font-semibold text-white">{L("Statistiques & Rapport de Traduction")}</span>
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
        <div className="p-4 space-y-4">
          {/* Progression en pourcentage */}
          <div className="p-4 bg-[#181818] border border-[#2e2e2e] rounded space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#dddddd] text-sm">{L("Taux de complétion")}</span>
              <span className="text-xl font-bold text-[#38bdf8]">{stats.percentage}%</span>
            </div>
            <div className="w-full bg-[#222222] h-3 rounded-full overflow-hidden border border-[#333333]">
              <div
                className="bg-gradient-to-r from-[#22c55e] to-[#0369a1] h-full transition-all duration-500"
                style={{ width: `${stats.percentage}%` }}
              />
            </div>
          </div>

          {/* Grille des indicateurs */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 bg-[#1e1e1e] border border-[#444444] rounded flex items-center justify-between">
              <div>
                <span className="text-[#86efac] block font-medium">{L("Traduits & Validés")}</span>
                <span className="text-lg font-bold text-white">{stats.translated}</span>
              </div>
              <CheckCircle2 className="w-5 h-5 text-[#4ade80]" />
            </div>

            <div className="p-3 bg-[#1a1a1a] border border-[#ef4444] rounded flex items-center justify-between">
              <div>
                <span className="text-[#fecaca] block font-medium">{L("Non Traduits")}</span>
                <span className="text-lg font-bold text-white">{stats.untranslated}</span>
              </div>
              <span className="w-4 h-4 rounded-full bg-[#ef4444]" />
            </div>

            <div className="p-3 bg-[#1e1e1e] border border-[#f59e0b] rounded flex items-center justify-between">
              <div>
                <span className="text-[#fde68a] block font-medium">{L("Partiels / En cours")}</span>
                <span className="text-lg font-bold text-white">{stats.partial}</span>
              </div>
              <span className="w-4 h-4 rounded-full bg-[#f59e0b]" />
            </div>

            <div className="p-3 bg-[#1a1a1a] border border-[#333333] rounded flex items-center justify-between">
              <div>
                <span className="text-[#38bdf8] block font-medium">{L("Identiques (Noms)")}</span>
                <span className="text-lg font-bold text-white">{stats.identical}</span>
              </div>
              <span className="w-4 h-4 rounded-full bg-[#0369a1]" />
            </div>
          </div>

          {/* Métriques de mots et alertes */}
          <div className="p-3 bg-[#181818] border border-[#2e2e2e] rounded space-y-2 text-[13px]">
            <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
              <span className="text-[#aaaaaa]">{L("Total d'enregistrements :")}</span>
              <span className="font-mono font-medium text-white">{stats.total}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
              <span className="text-[#aaaaaa]">{L("Mots VO (Source) :")}</span>
              <span className="font-mono font-medium text-[#38bdf8]">{stats.wordCountSource}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
              <span className="text-[#aaaaaa]">{L("Mots VF (Traduction) :")}</span>
              <span className="font-mono font-medium text-[#4ade80]">{stats.wordCountTarget}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#aaaaaa] flex items-center space-x-1">
                <AlertTriangle className="w-3.5 h-3.5 text-[#fbbf24]" />
                <span>{L("Alertes de balises manquantes :")}</span>
              </span>
              <span className={`font-mono font-medium ${stats.warningsCount > 0 ? 'text-[#f87171]' : 'text-[#4ade80]'}`}>
                {stats.warningsCount}
              </span>
            </div>
          </div>
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
            onClick={handleExportReport}
            className="px-4 py-1.5 bg-[#0369a1] hover:bg-[#0369a1] text-white font-medium rounded transition-colors flex items-center space-x-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{L("Télécharger le rapport TXT")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
