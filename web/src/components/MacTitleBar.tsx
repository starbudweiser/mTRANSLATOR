/**
 * Barre de titre et d'en-tête macOS native pour mTRANSLATOR
 * En-tête d'application avec logo livre "A", titre "mTRANSLATOR" et sélecteur interactif de langue
 * permettant de changer la langue des traductions et la localisation globale de l'interface.
 * La barre de titre est celle de la fenêtre macOS native ; « Fermer le fichier » et « À propos »
 * sont dans les menus natifs (python_app/mtranslator_app.py).
 */

import React, { useState, useRef, useEffect } from 'react';
import { ModFileMeta, GameEngine } from '../types';
import { BookLogo } from './BookLogo';
import { ArrowRight, HardDrive, X, Check, HelpCircle, ChevronDown, Globe, CheckCircle2 } from 'lucide-react';
import { useI18n } from '../i18n/LanguageContext';
import { SupportedLocale } from '../i18n/types';
import { L } from '../i18n/L';

interface MacTitleBarProps {
  meta: ModFileMeta;
  modifiedCount: number;
  isFileLoaded: boolean;
  onSelectGame: (game: GameEngine) => void;
  onSave: () => void;
  onCloseFile: () => void;
  onOpenAbout?: () => void;
  /** Pourcentage de chaînes traduites du fichier ouvert. */
  progress?: number;
  simpleMode: boolean;
  onSimpleModeChange: (simple: boolean) => void;
}

export const MacTitleBar: React.FC<MacTitleBarProps> = ({
  meta,
  modifiedCount,
  isFileLoaded,
  onSave,
  onCloseFile,
  onOpenAbout,
  progress = 0,
  simpleMode,
  onSimpleModeChange,
}) => {
  const { t, sourceLang, targetLang, targetLocale, setTargetLanguage, languages, uiLocale, setUiLanguage, uiLanguages } = useI18n();
  const [isUiMenuOpen, setIsUiMenuOpen] = useState(false);
  const uiMenuRef = useRef<HTMLDivElement>(null);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);

  // Fermer le menu lors d'un clic en dehors
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setIsLangMenuOpen(false);
      }
      if (uiMenuRef.current && !uiMenuRef.current.contains(e.target as Node)) {
        setIsUiMenuOpen(false);
      }
    };
    if (isLangMenuOpen || isUiMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isLangMenuOpen, isUiMenuOpen]);

  // Récupérer le drapeau actuel
  const currentLangObj = languages.find((l) => l.code === targetLocale);

  return (
    <div className="flex flex-col select-none z-20">
      {/* En-tête de l'application (la barre de titre est celle de la fenêtre macOS) */}
      <div className="h-11 bg-[#181818] border-b border-[#2e2e2e] flex items-center justify-between gap-4 px-4">
        {/* Côté gauche : Logo livre A + Titre + Sous-titre */}
        <div className="flex items-center space-x-2.5">
          {/* Badge logo ambré avec lettre A */}
          <button
            type="button"
            onClick={onOpenAbout}
            className="w-6 h-6 rounded bg-[#d97706]/30 border border-[#f59e0b]/70 flex items-center justify-center p-0.5 shadow-sm hover:scale-105 transition-transform"
            title="mTRANSLATOR macOS"
          >
            <BookLogo size={16} className="text-[#fbbf24]" />
          </button>

          <button
            type="button"
            onClick={onOpenAbout}
            className="text-left flex items-center space-x-2 hover:opacity-90 transition-opacity"
            title={t('app.aboutTitle')}
          >
            <span className="font-bold text-white text-[15px] tracking-tight">
              {t('app.title')}
            </span>
            <span className="text-[14px] text-[#aaaaaa]">
              {t('app.subtitle')}
            </span>
          </button>
        </div>

        {/* Côté droit : état du fichier, mode d'affichage et sélecteur de langue */}
        <div className="flex items-center space-x-3 shrink-0">
          {/* Langue de l'interface (drapeau), indépendante de la langue des traductions */}
          <div className="relative" ref={uiMenuRef}>
            <button
              type="button"
              onClick={() => setIsUiMenuOpen(!isUiMenuOpen)}
              className="text-base leading-none px-1.5 py-1 rounded hover:bg-[#262626] transition-colors"
              title={L("Langue de l'interface")}
            >
              {uiLanguages.find((l) => l.code === uiLocale)?.flag}
            </button>
            {isUiMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-[#1e1e1e] border border-[#333333] rounded-lg shadow-2xl py-1 z-50 text-[13px] text-[#dddddd]">
                {uiLanguages.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      setUiLanguage(lang.code);
                      setIsUiMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors ${
                      lang.code === uiLocale ? 'text-[#38bdf8] font-medium' : 'hover:bg-[#2c2c2c]'
                    }`}
                  >
                    <span>{lang.flag}  {lang.name}</span>
                    {lang.code === uiLocale && <Check className="w-3.5 h-3.5 text-[#38bdf8]" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Commutateur Simple / Expert */}
          <div
            className="flex items-center bg-[#222222] border border-[#333333] rounded-md p-0.5 text-[13px]"
            role="group"
            aria-label={L("Mode d'affichage")}
            title={L("Simple : l'essentiel pour traduire un plugin. Expert : tous les outils.")}
          >
            {([['Simple', true], ['Expert', false]] as const).map(([label, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => onSimpleModeChange(value)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  simpleMode === value ? 'bg-[#0369a1] text-white font-semibold' : 'text-[#aaaaaa] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {isFileLoaded && (
            <div className="flex items-center space-x-2 text-xs">

              {modifiedCount > 0 ? (
                <button
                  type="button"
                  onClick={onSave}
                  className="text-[12px] text-[#fbbf24] bg-[#3f2a0c]/80 px-1.5 py-0.5 rounded border border-[#f59e0b] hover:bg-[#3f2a0c] transition-colors"
                  title={L("Cliquer pour sauvegarder (⌘S)")}
                >
                  {t('app.modified', { count: modifiedCount })}
                </button>
              ) : (
                <span className="text-[12px] text-[#4ade80] flex items-center space-x-1">
                  <Check className="w-3 h-3" />
                  <span>{t('app.ready')}</span>
                </span>
              )}

              {/* Bouton pour revenir à la page d'accueil / dropzone */}
              <button
                type="button"
                onClick={onCloseFile}
                className="px-2 py-0.5 bg-[#222222] hover:bg-[#333333] text-[#aaaaaa] hover:text-white rounded border border-[#333333] text-[13px] transition-colors flex items-center space-x-1"
                title={L("Fermer le fichier actuel et revenir à l'écran de dépôt")}
              >
                <X className="w-3 h-3" />
                <span>{t('app.home')}</span>
              </button>
            </div>
          )}

          {/* SÉLECTEUR INTERACTIF DE LANGUE DES TRADUCTIONS (English ➔ Français, Deutsch, etc.) */}
          <div className="relative" ref={langMenuRef}>
            <button
              type="button"
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              className="flex items-center space-x-2 text-xs text-[#dddddd] bg-[#1e1e1e] hover:bg-[#262626] px-2.5 py-1 rounded border border-[#333333] hover:border-[#38bdf8] transition-all shadow-xs group"
              title={L("Cliquez pour changer la langue des traductions")}
            >
              <span className="text-sm leading-none">{currentLangObj?.flag || '🇫🇷'}</span>
              <span className="text-[#aaaaaa]">{sourceLang}</span>
              <ArrowRight className="w-3 h-3 text-[#38bdf8] group-hover:translate-x-0.5 transition-transform" />
              <span className="font-semibold text-white">{targetLang}</span>
              <ChevronDown className={`w-3 h-3 text-[#aaaaaa] transition-transform duration-200 ${isLangMenuOpen ? 'rotate-180 text-[#38bdf8]' : ''}`} />
            </button>

            {/* Menu Popover macOS déroulant */}
            {isLangMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 bg-[#1e1e1e] border border-[#333333] rounded-lg shadow-2xl py-2 z-50 text-xs text-[#dddddd] animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="px-3 py-1.5 border-b border-[#2e2e2e] mb-1">
                  <div className="flex items-center space-x-1.5 text-white font-medium text-[13px]">
                    <Globe className="w-3.5 h-3.5 text-[#38bdf8]" />
                    <span>{t('app.targetLanguage')}</span>
                  </div>
                  <p className="text-[12px] text-[#aaaaaa] mt-0.5 leading-snug">{L("Définit la langue cible des traductions et configure les nouveaux dictionnaires SST.")}</p>
                </div>

                <div className="max-h-60 overflow-y-auto custom-scrollbar px-1">
                  {languages.map((lang) => {
                    const isSelected = lang.code === targetLocale;
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => {
                          setTargetLanguage(lang.code);
                          setIsLangMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-colors ${
                          isSelected
                            ? 'bg-[#0369a1]/20 text-[#38bdf8] font-medium'
                            : 'hover:bg-[#2c2c2c] text-[#dddddd]'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          <span className="text-base leading-none">{lang.flag}</span>
                          <div>
                            <span className="text-[14px]">{lang.name}</span>
                            <span className="text-[12px] text-[#666666] ml-1.5 font-mono">({lang.code})</span>
                          </div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#38bdf8]" />}
                      </button>
                    );
                  })}
                </div>

                <div className="px-3 pt-2 mt-1.5 border-t border-[#2e2e2e] text-[12px] text-[#666666] flex items-center justify-between">
                  <span>{L("Source :")} {sourceLang}</span>
                  <span className="text-[#38bdf8] font-mono">mTRANSLATOR</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bande du plugin ouvert : nom bien visible et progression */}
      {isFileLoaded && (
        <div
          className="bg-[#0c3a52]/50 border-b border-[#0369a1]/60 px-4 py-2 flex items-center gap-3"
          title={meta.fileName}
        >
          <HardDrive className="w-5 h-5 text-[#38bdf8] shrink-0" />
          <span className="text-[13px] uppercase tracking-wider text-[#7dd3fc] shrink-0">{L("Plugin ouvert")}</span>
          <span className="text-[20px] font-bold text-white truncate min-w-0">{meta.fileName}</span>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <div className="w-32 h-2 bg-[#181818] rounded-full overflow-hidden border border-[#0369a1]/40">
              <div className="h-full bg-[#38bdf8] rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[14px] font-semibold text-[#38bdf8] w-20">{progress}{L("% traduit")}</span>
          </div>
        </div>
      )}
    </div>
  );
};
