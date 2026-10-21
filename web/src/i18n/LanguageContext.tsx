import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { SupportedLocale, LanguageInfo, AVAILABLE_LANGUAGES, I18nContextType } from './types';
import { TRANSLATIONS } from './translations';
import { UiLocale, UI_LANGUAGES, getUiLocale, setUiLocaleValue } from './L';

const STORAGE_KEY_LOCALE = 'mtranslator_target_lang';
const STORAGE_KEY_SOURCE = 'mtranslator_source_lang';

const I18nContext = createContext<I18nContextType | null>(null);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Par défaut, à la compilation / au premier lancement : 'fr' (Français)
  const [targetLocale, setTargetLocaleState] = useState<SupportedLocale>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LOCALE) as SupportedLocale;
      if (saved && AVAILABLE_LANGUAGES.some((l) => l.code === saved)) {
        return saved;
      }
    } catch {}
    return 'fr';
  });

  // Langue de l'interface : indépendante de la langue cible des traductions
  const [uiLocale, setUiLocaleState] = useState<UiLocale>(getUiLocale);

  const setUiLanguage = (code: UiLocale) => {
    setUiLocaleValue(code);
    setUiLocaleState(code);
  };

  const [sourceLang, setSourceLangState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SOURCE);
      if (saved) return saved;
    } catch {}
    return 'English';
  });

  // Calcul du nom lisible de la langue cible
  const targetLangInfo = useMemo(() => {
    return AVAILABLE_LANGUAGES.find((l) => l.code === targetLocale) || AVAILABLE_LANGUAGES[0];
  }, [targetLocale]);

  const targetLang = targetLangInfo.name;

  const setTargetLanguage = (code: SupportedLocale) => {
    setTargetLocaleState(code);
    try {
      localStorage.setItem(STORAGE_KEY_LOCALE, code);
    } catch {}
  };

  const setSourceLanguage = (lang: string) => {
    setSourceLangState(lang);
    try {
      localStorage.setItem(STORAGE_KEY_SOURCE, lang);
    } catch {}
  };

  // Attribut lang du document HTML : langue de l'interface. L'app macOS la mémorise aussi pour
  // ses menus natifs (appliquée au lancement suivant) ; sans serveur local, la requête échoue sans gêne.
  useEffect(() => {
    document.documentElement.lang = uiLocale;
    fetch('/api/ui-lang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-mTRANSLATOR': '1' },
      body: JSON.stringify({ lang: uiLocale }),
    }).catch(() => {});
  }, [uiLocale]);

  // Fonction de traduction avec substitution de paramètres et fallback français garanti
  const t = (key: string, params?: Record<string, string | number>): string => {
    const localeDict = TRANSLATIONS[uiLocale] || TRANSLATIONS.fr;
    let text = localeDict[key] || TRANSLATIONS.fr[key] || key;

    if (params) {
      Object.entries(params).forEach(([paramKey, val]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(val));
      });
    }

    return text;
  };

  const contextValue: I18nContextType = {
    locale: uiLocale,
    uiLocale,
    setUiLanguage,
    uiLanguages: UI_LANGUAGES,
    targetLocale,
    sourceLang,
    targetLang,
    setTargetLanguage,
    setSourceLanguage,
    t,
    languages: AVAILABLE_LANGUAGES,
  };

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within a LanguageProvider');
  }
  return context;
};
