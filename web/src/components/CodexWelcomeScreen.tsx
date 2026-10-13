import React, { useState } from 'react';
import { BookLogo } from './BookLogo';
import { Folder, Upload, Sparkles, FileText, Info } from 'lucide-react';
import { useI18n } from '../i18n/LanguageContext';

interface CodexWelcomeScreenProps {
  onOpenFileClick: () => void;
  onOpenSample: (sampleKey: 'skyrim' | 'fallout' | 'starfield') => void;
  onDropFiles: (file: File) => void;
  onOpenAbout?: () => void;
}

export const CodexWelcomeScreen: React.FC<CodexWelcomeScreenProps> = ({
  onOpenFileClick,
  onOpenSample,
  onDropFiles,
  onOpenAbout,
}) => {
  const { t } = useI18n();
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDropFiles(e.dataTransfer.files[0]);
    }
  };

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex-1 flex flex-col items-center justify-center p-8 select-none transition-colors relative ${
        isDragOver ? 'bg-[#1e1e1e] border-2 border-dashed border-[#0ea5e9]' : 'bg-[#181818]'
      }`}
    >
      {/* Contenu central exactement comme conçu par Codex */}
      <div className="flex flex-col items-center text-center max-w-lg">
        {/* Grand logo Livre avec lettre A dorée/ambrée */}
        <div className="mb-4 relative group">
          <BookLogo size={68} className="text-[#fbbf24] drop-shadow-lg transition-transform group-hover:scale-105 duration-200" />
        </div>

        {/* Titre mTRANSLATOR */}
        <h1 className="text-3xl font-bold text-white tracking-tight mb-1">
          mTRANSLATOR
        </h1>
        <div className="flex items-center space-x-2 justify-center mb-3">
          <span className="text-[11px] text-[#38bdf8] font-mono bg-[#0c3a52] px-2 py-0.5 rounded border border-[#0369a1]/40">
            macOS Edition
          </span>
          {onOpenAbout && (
            <button
              type="button"
              onClick={onOpenAbout}
              className="text-[11px] text-[#aaaaaa] hover:text-white underline underline-offset-2 flex items-center space-x-1"
            >
              <Info className="w-3 h-3 text-[#38bdf8]" />
              <span>{t('app.about')}</span>
            </button>
          )}
        </div>

        {/* Sous-titre officiel Codex */}
        <p className="text-sm text-[#aaaaaa] mb-7 leading-relaxed">
          {t('welcome.subtitle')}
        </p>

        {/* Bouton bleu vif Ouvrir un fichier */}
        <button
          type="button"
          onClick={onOpenFileClick}
          className="flex items-center space-x-2.5 px-6 py-2.5 bg-[#0369a1] hover:bg-[#0369a1] text-white font-semibold text-sm rounded-lg shadow-lg shadow-sky-600/25 active:scale-98 transition-all"
        >
          <Folder className="w-4 h-4 fill-white/20" />
          <span>{t('welcome.openButton')}</span>
        </button>

        {/* Raccourcis pour charger un échantillon de mod pour tester immédiatement */}
        <div className="mt-10 pt-6 border-t border-[#2e2e2e] w-full flex flex-col items-center">
          <span className="text-[11px] text-[#666666] mb-2.5 flex items-center space-x-1">
            <Sparkles className="w-3 h-3 text-[#fbbf24]" />
            <span>{t('welcome.samplePrompt')}</span>
          </span>
          <div className="flex items-center space-x-2 text-xs">
            <button
              type="button"
              onClick={() => onOpenSample('skyrim')}
              className="px-2.5 py-1 bg-[#222222] hover:bg-[#2c2c2c] border border-[#333333] hover:border-[#38bdf8] text-[#38bdf8] rounded transition-colors"
            >
              Skyrim SE (Inigo)
            </button>
            <button
              type="button"
              onClick={() => onOpenSample('fallout')}
              className="px-2.5 py-1 bg-[#222222] hover:bg-[#2c2c2c] border border-[#333333] hover:border-[#f59e0b] text-[#fbbf24] rounded transition-colors"
            >
              Fallout 4 (SS2)
            </button>
            <button
              type="button"
              onClick={() => onOpenSample('starfield')}
              className="px-2.5 py-1 bg-[#222222] hover:bg-[#2c2c2c] border border-[#333333] hover:border-[#0ea5e9] text-[#38bdf8] rounded transition-colors"
            >
              Starfield
            </button>
          </div>
        </div>

        {isDragOver && (
          <div className="absolute inset-4 bg-[#0369a1]/10 backdrop-blur-xs border-2 border-dashed border-[#0ea5e9] rounded-xl flex items-center justify-center z-30">
            <div className="bg-[#1a1a1a] px-6 py-4 rounded-xl shadow-2xl border border-[#0ea5e9] flex items-center space-x-3 text-[#38bdf8]">
              <Upload className="w-6 h-6 animate-bounce" />
              <span className="font-semibold text-sm">Déposez votre fichier Bethesda pour l'importer instantanément</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
