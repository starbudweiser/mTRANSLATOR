/**
 * Traduction par lots (comme « Batch translation » de xTranslator) : chaque plugin est traduit par xtcore
 * avec les dictionnaires SST. Le plugin écrit ne reçoit que les correspondances exactes ; le SST contient
 * aussi les correspondances approchantes, marquées à revoir.
 */

import React, { useState } from 'react';
import { X, Layers, FolderOpen, Plus, Trash2, Play, Loader2, Check, AlertCircle, FileText } from 'lucide-react';
import { xt, pickFile, pickFiles, getXtDict } from '../utils/xtcore';

interface BatchTranslateModalProps {
  isOpen: boolean;
  onClose: () => void;
  xtReady: boolean;
  /** Ouvre un plugin dans l'éditeur pour relire ses traductions. */
  onOpenInEditor: (path: string) => void;
}

interface Item {
  path: string;
  status: 'pending' | 'running' | 'done' | 'error';
  strings?: number;
  exact?: number;
  heuristic?: number;
  error?: string;
}

const OUT_KEY = 'mtranslator_batch_out';
const readOut = () => {
  try {
    return localStorage.getItem(OUT_KEY) || '';
  } catch {
    return '';
  }
};
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'));
const nameOf = (p: string) => p.split('/').pop() || p;

export const BatchTranslateModal: React.FC<BatchTranslateModalProps> = ({ isOpen, onClose, xtReady, onOpenInEditor }) => {
  const [items, setItems] = useState<Item[]>([]);
  const [outDir, setOutDir] = useState(readOut);
  const [writePlugin, setWritePlugin] = useState(true);
  const [writeSst, setWriteSst] = useState(true);
  const [heuristic, setHeuristic] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const patch = (path: string, p: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.path === path ? { ...it, ...p } : it)));

  const addFiles = async () => {
    try {
      const paths = await pickFiles({
        title: 'Plugins à traduire',
        fileTypes: ['Plugins Bethesda (*.esp;*.esm;*.esl)'],
      });
      setItems((list) => {
        const known = new Set(list.map((i) => i.path));
        return [
          ...list,
          ...paths.filter((p) => /\.(esp|esm|esl)$/i.test(p) && !known.has(p)).map((path) => ({ path, status: 'pending' as const })),
        ];
      });
    } catch (err: any) {
      setError(`Sélecteur natif indisponible : ${err.message}`);
    }
  };

  const chooseOut = async () => {
    const dir = await pickFile({ mode: 'folder', title: 'Dossier de sortie', directory: outDir || undefined }).catch(() => null);
    if (!dir) return;
    const clean = dir.replace(/\/$/, '');
    setOutDir(clean);
    try {
      localStorage.setItem(OUT_KEY, clean);
    } catch {
      // réglage non conservé
    }
  };

  // Le plugin traduit ne doit jamais écraser l'original, ni le SST un dictionnaire existant
  const clash = writePlugin && items.some((i) => dirOf(i.path) === outDir);
  const dictClash = writeSst && outDir === getXtDict().replace(/\/$/, '');

  const run = async () => {
    setError(null);
    setRunning(true);
    const dict = getXtDict();
    for (const it of items) {
      if (it.status === 'done') continue;
      patch(it.path, { status: 'running', error: undefined });
      const base = nameOf(it.path).replace(/\.[^.]+$/, '');
      try {
        const res = await xt.translate(it.path, dict, {
          out: writePlugin ? `${outDir}/${nameOf(it.path)}` : undefined,
          sst: writeSst ? `${outDir}/${base}_FR.sst` : undefined,
          maxLd: heuristic ? undefined : 0,
        });
        patch(it.path, { status: 'done', strings: res.strings, exact: res.exact, heuristic: res.heuristic });
      } catch (err: any) {
        patch(it.path, { status: 'error', error: err.message });
      }
    }
    setRunning(false);
  };

  const done = items.filter((i) => i.status === 'done');
  const totals = done.reduce(
    (t, i) => ({ s: t.s + (i.strings ?? 0), e: t.e + (i.exact ?? 0), h: t.h + (i.heuristic ?? 0) }),
    { s: 0, e: 0, h: 0 },
  );
  const canRun = xtReady && !running && items.some((i) => i.status !== 'done') && outDir && (writePlugin || writeSst) && !clash && !dictClash;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-4 text-xs select-none">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-md shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden text-[#dddddd]">
        <div className="h-10 shrink-0 bg-[#262626] border-b border-[#333333] px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-[#38bdf8]" />
            <span className="font-semibold text-white">Traduction par lots (dictionnaires SST)</span>
          </div>
          <button type="button" onClick={onClose} className="text-[#aaaaaa] hover:text-white p-1 rounded hover:bg-[#303030]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {!xtReady && (
            <div className="p-2.5 border border-[#ef4444] rounded text-[#fecaca] flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-[#f87171] shrink-0" />
              <span>Le cœur xtcore n'est disponible que dans l'app macOS compilée.</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addFiles}
              disabled={running || !xtReady}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2c2c2c] hover:bg-[#404040] text-white rounded disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter des plugins…
            </button>
            <button
              type="button"
              onClick={() => setItems([])}
              disabled={running || !items.length}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2c2c2c] hover:bg-[#404040] text-white rounded disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Vider la liste
            </button>
            <span className="text-[#888888] truncate">Dictionnaires : {getXtDict()}</span>
          </div>

          <div className="p-3 bg-[#181818] border border-[#2e2e2e] rounded space-y-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={chooseOut}
                disabled={running}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-[#2c2c2c] hover:bg-[#404040] text-white rounded disabled:opacity-40"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Dossier de sortie…
              </button>
              <span className={`truncate ${outDir ? 'text-[#dddddd]' : 'text-[#888888]'}`}>{outDir || 'aucun dossier choisi'}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input type="checkbox" checked={writePlugin} onChange={(e) => setWritePlugin(e.target.checked)} className="accent-[#22c55e]" />
                <span>Plugin traduit (correspondances exactes)</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input type="checkbox" checked={writeSst} onChange={(e) => setWriteSst(e.target.checked)} className="accent-[#22c55e]" />
                <span>Dictionnaire SST (_FR.sst)</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input type="checkbox" checked={heuristic} onChange={(e) => setHeuristic(e.target.checked)} className="accent-[#22c55e]" />
                <span>Correspondances approchantes dans le SST (à revoir)</span>
              </label>
            </div>
            {dictClash && (
              <div className="text-[#fca5a5]">Le dossier des dictionnaires est exclu : un SST existant serait écrasé.</div>
            )}
            {clash && (
              <div className="text-[#fca5a5]">Choisissez un autre dossier que celui des plugins : l'original serait écrasé.</div>
            )}
          </div>

          {error && <div className="text-[#fca5a5]">{error}</div>}

          {items.length > 0 ? (
            <div className="border border-[#2e2e2e] rounded divide-y divide-[#2e2e2e]">
              {items.map((it) => (
                <div key={it.path} className="px-3 py-2 flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-4">
                    {it.status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-[#38bdf8]" />}
                    {it.status === 'done' && <Check className="w-4 h-4 text-[#4ade80]" />}
                    {it.status === 'error' && <AlertCircle className="w-4 h-4 text-[#f87171]" />}
                    {it.status === 'pending' && <FileText className="w-4 h-4 text-[#888888]" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-white truncate" title={it.path}>
                      {nameOf(it.path)}
                    </div>
                    <div className={`truncate ${it.status === 'error' ? 'text-[#fca5a5]' : 'text-[#888888]'}`}>
                      {it.status === 'done'
                        ? `${it.strings} textes · ${it.exact} exacts · ${it.heuristic} approchants`
                        : it.status === 'error'
                          ? it.error
                          : dirOf(it.path)}
                    </div>
                  </div>
                  {it.status === 'done' && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenInEditor(it.path);
                        onClose();
                      }}
                      className="shrink-0 px-2 py-1 bg-[#2c2c2c] hover:bg-[#404040] text-white rounded"
                      title="Ouvrir le plugin d'origine dans l'éditeur pour relire et compléter la traduction"
                    >
                      Ouvrir
                    </button>
                  )}
                  {!running && it.status !== 'running' && (
                    <button
                      type="button"
                      onClick={() => setItems((l) => l.filter((x) => x.path !== it.path))}
                      className="shrink-0 p-1 text-[#888888] hover:text-white rounded hover:bg-[#303030]"
                      title="Retirer de la liste"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-[#888888] border border-dashed border-[#333333] rounded">
              Ajoutez un ou plusieurs plugins (.esp, .esm, .esl).
            </div>
          )}
        </div>

        <div className="h-12 shrink-0 border-t border-[#333333] px-4 flex items-center justify-between gap-3">
          <span className="text-[#aaaaaa] truncate">
            {done.length
              ? `${done.length}/${items.length} fichier(s) : ${totals.e.toLocaleString()} exacts, ${totals.h.toLocaleString()} approchants sur ${totals.s.toLocaleString()} textes`
              : `${items.length} fichier(s)`}
          </span>
          <button
            type="button"
            onClick={run}
            disabled={!canRun}
            className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 bg-[#22c55e] hover:bg-[#16a34a] text-white font-medium rounded disabled:opacity-50"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? 'Traduction…' : 'Lancer'}
          </button>
        </div>
      </div>
    </div>
  );
};
