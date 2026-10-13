export type SupportedLocale = 'fr' | 'en' | 'de' | 'es' | 'it' | 'ru' | 'pl';

export interface LanguageInfo {
  code: SupportedLocale;
  name: string;        // Native name
  englishName: string; // English name
  flag: string;        // Emoji flag
}

export const AVAILABLE_LANGUAGES: LanguageInfo[] = [
  { code: 'fr', name: 'Français', englishName: 'French', flag: '🇫🇷' },
  { code: 'en', name: 'English', englishName: 'English', flag: '🇬🇧' },
  { code: 'de', name: 'Deutsch', englishName: 'German', flag: '🇩🇪' },
  { code: 'es', name: 'Español', englishName: 'Spanish', flag: '🇪🇸' },
  { code: 'it', name: 'Italiano', englishName: 'Italian', flag: '🇮🇹' },
  { code: 'pl', name: 'Polski', englishName: 'Polish', flag: '🇵🇱' },
  { code: 'ru', name: 'Русский', englishName: 'Russian', flag: '🇷🇺' },
];

export interface I18nContextType {
  locale: SupportedLocale;
  sourceLang: string;
  targetLang: string;
  targetLocale: SupportedLocale;
  setTargetLanguage: (code: SupportedLocale) => void;
  setSourceLanguage: (lang: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  languages: LanguageInfo[];
}
