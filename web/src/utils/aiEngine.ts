// Réglages du moteur de traduction automatique, communs à la traduction IA et aux lots.
import { getXtDict } from './xtcore';

export type AiEngine = 'google' | 'gemini';

export interface AiEngineSettings {
  engine: AiEngine;
  apiKey: string;
  model: string;
}

const KEY = 'mtranslator_ai_engine';
const GEMINI_KEY = 'mtranslator_gemini_key'; // clé historique, conservée
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export function getAiEngine(): AiEngineSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      engine: s.engine === 'gemini' ? 'gemini' : 'google',
      apiKey: localStorage.getItem(GEMINI_KEY) || '',
      model: s.model || DEFAULT_GEMINI_MODEL,
    };
  } catch {
    return { engine: 'google', apiKey: '', model: DEFAULT_GEMINI_MODEL };
  }
}

export function setAiEngine(s: AiEngineSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ engine: s.engine, model: s.model }));
    if (s.apiKey.trim()) localStorage.setItem(GEMINI_KEY, s.apiKey.trim());
    else localStorage.removeItem(GEMINI_KEY);
  } catch {
    // réglage non conservé
  }
}

export const engineLabel = (s: AiEngineSettings) =>
  s.engine === 'gemini' && s.apiKey ? `Gemini (${s.model})` : 'Google Traduction (gratuit)';

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-mTRANSLATOR': '1' },
    body: JSON.stringify(body),
  });

export interface AiBatchResult {
  translations: Array<{ id: string; translatedText: string }>;
  engine: string;
  warning?: string | null;
}

/** Traduction automatique d'un lot ; un texte non traduit revient inchangé. */
export async function translateBatch(
  items: Array<{ id: string; text: string }>,
  o: { targetLang?: string; game?: string; signal?: AbortSignal } = {},
): Promise<AiBatchResult> {
  const s = getAiEngine();
  const r = await fetch('/api/translate/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-mTRANSLATOR': '1' },
    signal: o.signal,
    body: JSON.stringify({
      items,
      targetLang: o.targetLang || 'Français',
      gameContext: o.game,
      engine: s.engine,
      apiKey: s.engine === 'gemini' ? s.apiKey : undefined,
      model: s.model,
      dict: getXtDict(),
    }),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error ?? `traduction : erreur ${r.status}`);
  return data;
}

/** Modèles Gemini disponibles pour la clé. */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  const r = await post('/api/translate/models', { apiKey });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error ?? `modèles : erreur ${r.status}`);
  return data.models ?? [];
}
