/**
 * Choix du moteur de traduction automatique : Google gratuit (sans clé) ou Gemini (clé API).
 */

import React, { useState } from 'react';
import { Key, Zap, Sparkles, RefreshCw } from 'lucide-react';
import { getAiEngine, setAiEngine, listGeminiModels, type AiEngineSettings } from '../utils/aiEngine';

export const EngineSettings: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  const [s, setS] = useState<AiEngineSettings>(getAiEngine);
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update = (p: Partial<AiEngineSettings>) => {
    const next = { ...s, ...p };
    setS(next);
    setAiEngine(next);
  };

  const loadModels = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const list = await listGeminiModels(s.apiKey);
      setModels(list);
      if (list.length && !list.includes(s.model)) update({ model: list.find((m) => m.includes('flash')) ?? list[0] });
      setMsg(list.length ? `Clé valide : ${list.length} modèle(s).` : 'Aucun modèle disponible pour cette clé.');
    } catch (err: any) {
      setMsg(`Clé refusée ou réseau indisponible : ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const card = (active: boolean) =>
    `p-2.5 rounded border text-left transition-colors disabled:opacity-50 ${
      active ? 'bg-[#262626] border-[#38bdf8] text-white ring-1 ring-[#38bdf8]' : 'bg-[#181818] border-[#2e2e2e] text-[#aaaaaa] hover:bg-[#262626]'
    }`;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button type="button" disabled={disabled} onClick={() => update({ engine: 'google' })} className={card(s.engine === 'google')}>
          <div className="flex items-center gap-1.5 font-semibold text-white text-[13px]">
            <Zap className="w-3.5 h-3.5 text-[#4ade80]" />
            <span>Google Traduction</span>
            <span className="bg-[#166534] text-white text-[11px] px-1 rounded">Gratuit</span>
          </div>
          <span className="text-[12px] text-[#aaaaaa] block mt-0.5">
            Sans clé, rapide. Balises protégées, noms officiels (Blancherive, Faillaise…) d'après les SST du jeu.
          </span>
        </button>
        <button type="button" disabled={disabled} onClick={() => update({ engine: 'gemini' })} className={card(s.engine === 'gemini')}>
          <div className="flex items-center gap-1.5 font-semibold text-white text-[13px]">
            <Sparkles className="w-3.5 h-3.5 text-[#fbbf24]" />
            <span>Gemini</span>
            <span className="bg-[#0369a1] text-white text-[11px] px-1 rounded">Clé API</span>
          </div>
          <span className="text-[12px] text-[#aaaaaa] block mt-0.5">
            Meilleure qualité pour dialogues et livres. Clé gratuite sur aistudio.google.com (quotas limités).
          </span>
        </button>
      </div>

      {s.engine === 'gemini' && (
        <div className="bg-[#181818] border border-[#2e2e2e] rounded p-2.5 space-y-1.5">
          <label className="text-[13px] font-medium flex items-center gap-1.5">
            <Key className="w-3 h-3 text-[#38bdf8]" />
            Clé API Gemini :
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={s.apiKey}
              disabled={disabled}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder="AIza…"
              className="flex-1 min-w-0 bg-[#1e1e1e] border border-[#444444] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#38bdf8]"
            />
            <button
              type="button"
              onClick={loadModels}
              disabled={disabled || loading || !s.apiKey.trim()}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-[#2c2c2c] hover:bg-[#404040] text-white rounded disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Vérifier
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] shrink-0">Modèle :</span>
            {models.length ? (
              <select
                value={s.model}
                disabled={disabled}
                onChange={(e) => update({ model: e.target.value })}
                className="flex-1 min-w-0 bg-[#222222] border border-[#444444] rounded px-2 py-1 text-white text-[13px] outline-none"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={s.model}
                disabled={disabled}
                onChange={(e) => update({ model: e.target.value })}
                className="flex-1 min-w-0 bg-[#1e1e1e] border border-[#444444] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#38bdf8]"
              />
            )}
          </div>
          <p className="text-[11px] text-[#aaaaaa]">
            {msg ?? 'Clé gardée sur ce Mac uniquement. Sans clé, Google Traduction gratuit est utilisé.'}
          </p>
        </div>
      )}
    </div>
  );
};
