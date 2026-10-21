import React from 'react';
import { X, Info, Sparkles, Heart, Code2, ExternalLink, Cpu, BookOpen, Layers } from 'lucide-react';
import { BookLogo } from './BookLogo';
import { L } from '../i18n/L';

interface AboutModalProps {
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-[2px] p-4 text-xs select-none">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-lg shadow-2xl w-full max-w-xl flex flex-col overflow-hidden text-[#dddddd]">
        {/* En-tête avec feux tricolores discrets et titre */}
        <div className="h-10 bg-[#262626] border-b border-[#333333] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Info className="w-4 h-4 text-[#38bdf8]" />
            <span className="font-semibold text-white">{L("À propos de mTRANSLATOR")}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#aaaaaa] hover:text-white p-1 rounded hover:bg-[#303030] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contenu principal */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Bannière principale */}
          <div className="flex items-center space-x-4 p-4 bg-[#181818] border border-[#2e2e2e] rounded-lg">
            <div className="w-12 h-12 rounded-lg bg-[#d97706]/30 border border-[#f59e0b]/70 flex items-center justify-center shrink-0 shadow-md">
              <BookLogo size={28} className="text-[#fbbf24]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-tight">mTRANSLATOR</h2>
                <span className="px-1.5 py-0.5 bg-[#0369a1] text-[#ffffff] text-[12px] font-mono rounded font-semibold">
                  v2.5 macOS
                </span>
              </div>
              <p className="text-xs text-[#aaaaaa] mt-0.5">{L("Environnement complet et moderne de traduction de mods Bethesda pour macOS")}</p>
            </div>
          </div>

          {/* Section Genèse & Remerciements */}
          <div className="p-3.5 bg-[#1a1a1a] border border-[#2e2e2e] rounded-md space-y-2 text-[14px] leading-relaxed">
            <div className="flex items-center space-x-2 text-white font-semibold">
              <Code2 className="w-4 h-4 text-[#38bdf8]" />
              <span>{L("Origine & Développement")}</span>
            </div>
            <p className="text-[#dddddd]">
              <strong>mTRANSLATOR</strong> {L("est inspiré et conçu sur la base de travail de référence du célèbre logiciel")}<span className="text-[#fbbf24] font-medium"> xTranslator</span> {L("(développé initialement pour Windows par")} <em>McGuffin</em>).
            </p>
            <p className="text-[#dddddd]">{L("Il a été intégralement redéveloppé et adapté pour l'écosystème")} <strong>macOS</strong> {L("par")}<span className="text-[#38bdf8] font-semibold"> Google AI Studio</span> &amp; 
              <span className="text-[#4ade80] font-semibold"> {L("Stéphan Le Gac Savoye")}</span> (aka <em>Starbudweiser</em>).
            </p>
          </div>

          {/* Fonctionnalités phares */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 bg-[#181818] border border-[#2e2e2e] rounded-md space-y-1">
              <div className="flex items-center space-x-1.5 text-white font-medium text-[13px]">
                <Layers className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span>{L("Compatibilité Binaire Complète")}</span>
              </div>
              <p className="text-[13px] text-[#aaaaaa]">{L("Lecture et écriture native des plugins Bethesda (.ESP, .ESM, .ESL) ainsi que des tables .STRINGS, .ILSTRINGS, .DLSTRINGS.")}</p>
            </div>

            <div className="p-3 bg-[#181818] border border-[#2e2e2e] rounded-md space-y-1">
              <div className="flex items-center space-x-1.5 text-white font-medium text-[13px]">
                <BookOpen className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span>{L("Dictionnaires & SST XML")}</span>
              </div>
              <p className="text-[13px] text-[#aaaaaa]">{L("Import / export 100% interopérable avec les dictionnaires SST officiels xTranslator et lexiques vanilla Bethesda.")}</p>
            </div>

            <div className="p-3 bg-[#181818] border border-[#2e2e2e] rounded-md space-y-1">
              <div className="flex items-center space-x-1.5 text-white font-medium text-[13px]">
                <Sparkles className="w-3.5 h-3.5 text-[#fbbf24]" />
                <span>{L("Moteur IA Haute Vitesse")}</span>
              </div>
              <p className="text-[13px] text-[#aaaaaa]">{L("Intégration optimisée de Gemini 3.1 Flash-Lite & 3.8 Flash avec préservation stricte des balises Papyrus et [pagebreak].")}</p>
            </div>

            <div className="p-3 bg-[#181818] border border-[#2e2e2e] rounded-md space-y-1">
              <div className="flex items-center space-x-1.5 text-white font-medium text-[13px]">
                <Cpu className="w-3.5 h-3.5 text-[#4ade80]" />
                <span>{L("Traitement Hors-Ligne & Batch")}</span>
              </div>
              <p className="text-[13px] text-[#aaaaaa]">{L("Moteur de substitution local ultra-rapide, traitement par lots de dossiers complets de mods et export macOS autonome.")}</p>
            </div>
          </div>

          {/* Jeux pris en charge */}
          <div className="p-3 bg-[#181818] border border-[#2e2e2e] rounded-md text-[13px] text-[#aaaaaa] flex items-center justify-between">
            <span>{L("Univers supportés :")}</span>
            <div className="flex items-center space-x-2 font-mono text-[12px] text-[#dddddd]">
              <span className="px-1.5 py-0.5 bg-[#222222] rounded">{L("Skyrim (LE / SE / VR)")}</span>
              <span className="px-1.5 py-0.5 bg-[#222222] rounded">Fallout 4</span>
              <span className="px-1.5 py-0.5 bg-[#222222] rounded">Starfield</span>
              <span className="px-1.5 py-0.5 bg-[#222222] rounded">Fallout 3 / NV / Oblivion</span>
            </div>
          </div>
        </div>

        {/* Pied de page */}
        <div className="h-12 bg-[#1a1a1a] border-t border-[#2e2e2e] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-1 text-[#666666] text-[13px]">
            <span>{L("Créé avec passion pour la communauté de modding francophone.")}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#0369a1] hover:bg-[#0369a1] text-white rounded font-medium transition-colors"
          >{L("Fermer")}</button>
        </div>
      </div>
    </div>
  );
};
