// Langue de l'interface (indépendante de la langue cible des traductions).
// Même principe que les autres applis : le texte français sert de clé.
// L("Texte {x}", { x: 1 }) renvoie la traduction de la langue d'interface active, ou le français
// si elle manque. Les traductions vivent dans uiTexts.ts sous la forme {texte_fr: [en, it, es]}.
import { UI_TEXTS } from './uiTexts';

export type UiLocale = 'fr' | 'en' | 'it' | 'es';

export const UI_LANGUAGES: { code: UiLocale; name: string; flag: string }[] = [
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
];

const STORAGE_KEY_UI = 'mtranslator_ui_lang';
const INDEX: Record<Exclude<UiLocale, 'fr'>, number> = { en: 0, it: 1, es: 2 };
const isUiLocale = (c: unknown): c is UiLocale => UI_LANGUAGES.some((l) => l.code === c);

/** Langue mémorisée, sinon première langue prise en charge du Mac, sinon anglais. */
export function detectUiLocale(): UiLocale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_UI);
    if (isUiLocale(saved)) return saved;
  } catch {}
  for (const lang of navigator.languages || [navigator.language]) {
    const code = (lang || '').slice(0, 2).toLowerCase();
    if (isUiLocale(code)) return code;
  }
  return 'en';
}

let current: UiLocale = detectUiLocale();

export const getUiLocale = (): UiLocale => current;

export function setUiLocaleValue(code: UiLocale): void {
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY_UI, code);
  } catch {}
}

export function L(text: string, params?: Record<string, string | number | null | undefined>): string {
  let out = text;
  if (current !== 'fr') {
    const tr = UI_TEXTS[text];
    if (tr) out = tr[INDEX[current]] || text;
  }
  if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return out.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}
