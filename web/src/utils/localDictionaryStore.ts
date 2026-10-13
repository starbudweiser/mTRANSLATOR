/**
 * Gestionnaire de Dictionnaire Local Auto-Alimenté & Base de Données de Traduction
 * - Base de données locale auto-alimentée au fil des traductions, exports et sauvegardes SST/TXT/ESP
 * - Indexation prioritaire O(1) pour les scans de traduction automatique
 * - Support de stockage persistant asynchrone IndexedDB (avec fallback synchrone localStorage pour le démarrage)
 * - Traitement non-bloquant par micro-tâches (yieldToMain) pour ingestion de volumes massifs (dizaines de milliers d'entrées)
 * - Déduplication intelligente et gestion du cache unifié
 */

import { DictionaryEntry, ModRecord } from '../types';
import { VANILLA_DICTIONARY, DEV_TEST_DICTIONARIES } from '../data/vanillaDictionaries';
import { calculateSimilarity, exportToSST } from './translatorUtils';
import { idbAdapter } from './indexedDbAdapter';
import { yieldToMain } from './sstParser';

export interface LocalDictionaryStats {
  totalEntries: number;
  userLearnedEntries: number;
  vanillaEntries: number;
  lastUpdated: string;
  gameCounts: Record<string, number>;
}

export interface LearnedEntryMeta {
  source: string;
  target: string;
  game: string;
  context?: string;
  lang?: string;
  sourceLang?: string;
  origin?: 'manual_edit' | 'validation' | 'sst_import' | 'sst_export' | 'save_plugin' | 'txt_import' | 'dev_test' | 'created_sst';
  addedAt?: string;
  useCount?: number;
}

const STORAGE_KEY_CUSTOM_DICT = 'mtranslator_local_custom_dict_v1';
const STORAGE_KEY_SETTINGS = 'mtranslator_local_dict_settings_v1';
const LEGACY_STORAGE_KEY_CUSTOM_DICT = 'xtranslator_local_custom_dict_v1';
const LEGACY_STORAGE_KEY_SETTINGS = 'xtranslator_local_dict_settings_v1';

export interface LocalDictSettings {
  autoLearnOnSave: boolean;        // Auto-alimenter lors de la sauvegarde du plugin
  autoLearnOnValidate: boolean;    // Auto-alimenter lors de la validation d'une ligne
  autoLearnOnExportSST: boolean;   // Auto-alimenter lors de l'export SST/TXT
  priorityScanLocalFirst: boolean; // Scanner en priorité absolue ce dictionnaire local
  overwritePreviousIfBetter: boolean;
}

export const DEFAULT_DICT_SETTINGS: LocalDictSettings = {
  autoLearnOnSave: true,
  autoLearnOnValidate: true,
  autoLearnOnExportSST: true,
  priorityScanLocalFirst: true,
  overwritePreviousIfBetter: true,
};

// Indexation statique O(1) de la base Vanilla Bethesda
const VANILLA_EXACT_MAP = new Map<string, DictionaryEntry>();
VANILLA_DICTIONARY.forEach((v) => {
  if (v.source) {
    VANILLA_EXACT_MAP.set(v.source.trim().toLowerCase(), v);
  }
});

class LocalDictionaryStore {
  private learnedEntriesMap: Map<string, LearnedEntryMeta> = new Map();
  private settings: LocalDictSettings = { ...DEFAULT_DICT_SETTINGS };
  private listeners: Set<() => void> = new Set();
  private isInitialized = false;
  private pendingPersistTimer: any = null;
  private isSavingToIdb = false;
  private pendingEntriesForIdb: Array<LearnedEntryMeta & { key: string }> = [];

  constructor() {
    this.loadFromStorage();
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error('Error notifying dictionary listener:', e);
      }
    });
  }

  public getSettings(): LocalDictSettings {
    return { ...this.settings };
  }

  public updateSettings(newSettings: Partial<LocalDictSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(this.settings));
    } catch {}
    this.notify();
  }

  /**
   * Charge la base de données locale auto-alimentée :
   * 1. Charge d'abord rapidement le cache initial de localStorage (instantané au rendu)
   * 2. Tente ensuite de charger la totalité depuis IndexedDB en arrière-plan sans bloquer
   */
  public async loadFromStorage() {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS) || localStorage.getItem(LEGACY_STORAGE_KEY_SETTINGS);
      if (savedSettings) {
        this.settings = { ...DEFAULT_DICT_SETTINGS, ...JSON.parse(savedSettings) };
      }

      // Cache rapide localStorage
      const savedDict = localStorage.getItem(STORAGE_KEY_CUSTOM_DICT) || localStorage.getItem(LEGACY_STORAGE_KEY_CUSTOM_DICT);
      if (savedDict) {
        const parsed = JSON.parse(savedDict);
        if (Array.isArray(parsed)) {
          parsed.forEach((item: LearnedEntryMeta) => {
            if (item.source && item.target) {
              this.learnedEntriesMap.set(item.source.trim().toLowerCase(), item);
            }
          });
        }
      }
    } catch (e) {
      console.warn('Erreur lecture cache local:', e);
    }

    this.isInitialized = true;
    this.notify();

    // Hydratation asynchrone complète depuis IndexedDB
    try {
      const idbEntries = await idbAdapter.getAll();
      if (idbEntries && idbEntries.length > 0) {
        let changed = false;
        idbEntries.forEach((item) => {
          const k = item.source.trim().toLowerCase();
          if (!this.learnedEntriesMap.has(k)) {
            this.learnedEntriesMap.set(k, item);
            changed = true;
          }
        });
        if (changed) {
          this.notify();
        }
      }
    } catch (err) {
      console.warn('IndexedDB hydration fallback:', err);
    }
  }

  /**
   * Persistance asynchrone groupée (debounced) :
   * - Ne bloque JAMAIS l'UI
   * - Sauvegarde les premiers milliers en localStorage pour le démarrage rapide
   * - Sauvegarde la totalité dans IndexedDB par transaction de fond
   */
  private schedulePersist(newBatch?: Array<LearnedEntryMeta & { key: string }>) {
    if (newBatch && newBatch.length > 0) {
      this.pendingEntriesForIdb.push(...newBatch);
    }

    if (this.pendingPersistTimer) {
      clearTimeout(this.pendingPersistTimer);
    }

    this.pendingPersistTimer = setTimeout(() => {
      this.flushPersist();
    }, 150);
  }

  private async flushPersist() {
    // 1. Sauvegarde d'un échantillon de sécurité dans localStorage (max 2000 entrées pour éviter QuotaExceededError)
    try {
      const sample = Array.from(this.learnedEntriesMap.values()).slice(0, 2000);
      localStorage.setItem(STORAGE_KEY_CUSTOM_DICT, JSON.stringify(sample));
    } catch {
      // Ignorer si localStorage est plein
    }

    // 2. Sauvegarde de fond dans IndexedDB
    if (this.pendingEntriesForIdb.length > 0 && !this.isSavingToIdb) {
      this.isSavingToIdb = true;
      const batchToSave = this.pendingEntriesForIdb.splice(0, this.pendingEntriesForIdb.length);
      try {
        await idbAdapter.putBatch(batchToSave);
      } catch (err) {
        console.warn('Erreur flush IndexedDB:', err);
      } finally {
        this.isSavingToIdb = false;
        if (this.pendingEntriesForIdb.length > 0) {
          this.schedulePersist();
        }
      }
    }

    this.notify();
  }

  /**
   * Auto-alimente la base avec une seule entrée validée ou traduite
   */
  public learnSingle(
    source: string,
    target: string,
    game: string = 'Skyrim Special Edition',
    origin: LearnedEntryMeta['origin'] = 'validation',
    context?: string
  ): boolean {
    if (!source || !target) return false;
    const cleanSource = source.trim();
    const cleanTarget = target.trim();
    if (!cleanSource || !cleanTarget) return false;
    if (cleanSource === cleanTarget && cleanSource.length > 25) return false;

    const key = cleanSource.toLowerCase();
    const existing = this.learnedEntriesMap.get(key);
    const now = new Date().toISOString();

    const entryData: LearnedEntryMeta & { key: string } = {
      key,
      source: cleanSource,
      target: cleanTarget,
      game: game || existing?.game || 'Skyrim Special Edition',
      context: context || existing?.context,
      origin,
      addedAt: now,
      useCount: (existing?.useCount || 0) + 1,
    };

    if (existing) {
      if (existing.target !== cleanTarget && this.settings.overwritePreviousIfBetter) {
        this.learnedEntriesMap.set(key, entryData);
        this.schedulePersist([entryData]);
        return true;
      } else {
        existing.useCount = (existing.useCount || 1) + 1;
        this.schedulePersist([entryData]);
        return false;
      }
    } else {
      this.learnedEntriesMap.set(key, entryData);
      this.schedulePersist([entryData]);
      return true;
    }
  }

  /**
   * Auto-alimente la base en masse à partir d'une liste de ModRecords
   */
  public learnFromRecords(
    records: ModRecord[],
    game: string,
    origin: LearnedEntryMeta['origin'] = 'save_plugin'
  ): number {
    let learnedCount = 0;
    const now = new Date().toISOString();
    const batchToPersist: Array<LearnedEntryMeta & { key: string }> = [];

    records.forEach((r) => {
      const src = r.source?.trim();
      const tgt = r.target?.trim();
      if (src && tgt && (r.status === 'translated' || r.validated || tgt !== src || src.length < 20)) {
        const key = src.toLowerCase();
        const existing = this.learnedEntriesMap.get(key);

        if (!existing || (existing.target !== tgt && this.settings.overwritePreviousIfBetter)) {
          const entry: LearnedEntryMeta & { key: string } = {
            key,
            source: src,
            target: tgt,
            game: game || existing?.game || 'Skyrim Special Edition',
            context: r.recordType ? `Record ${r.recordType} (${r.edid || r.formId})` : undefined,
            origin,
            addedAt: now,
            useCount: (existing?.useCount || 0) + 1,
          };
          this.learnedEntriesMap.set(key, entry);
          batchToPersist.push(entry);
          learnedCount++;
        }
      }
    });

    if (batchToPersist.length > 0) {
      this.schedulePersist(batchToPersist);
    }
    return learnedCount;
  }

  /**
   * Intègre des entrées issues d'un lot de dictionnaires ou d'un fichier SST / TXT
   * Version asynchrone haut débit sans blocage du thread
   */
  public async importEntriesAsync(
    entries: DictionaryEntry[],
    origin: LearnedEntryMeta['origin'] = 'sst_import',
    onChunkProgress?: (percent: number) => void
  ): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;
    const now = new Date().toISOString();
    const batchToPersist: Array<LearnedEntryMeta & { key: string }> = [];

    const total = entries.length;
    const chunkSize = 2500;

    for (let i = 0; i < total; i++) {
      const e = entries[i];
      const src = e.source?.trim();
      const tgt = e.target?.trim();

      if (src && tgt) {
        const key = src.toLowerCase();
        const existing = this.learnedEntriesMap.get(key);

        if (!existing) {
          const entry: LearnedEntryMeta & { key: string } = {
            key,
            source: src,
            target: tgt,
            game: e.game || 'Skyrim Special Edition',
            context: e.context,
            origin,
            addedAt: now,
            useCount: 1,
          };
          this.learnedEntriesMap.set(key, entry);
          batchToPersist.push(entry);
          added++;
        } else if (existing.target !== tgt && this.settings.overwritePreviousIfBetter) {
          const entry: LearnedEntryMeta & { key: string } = {
            key,
            source: src,
            target: tgt,
            game: e.game || existing.game,
            context: e.context || existing.context,
            origin,
            addedAt: now,
            useCount: (existing.useCount || 1) + 1,
          };
          this.learnedEntriesMap.set(key, entry);
          batchToPersist.push(entry);
          updated++;
        }
      }

      // Découpe asynchrone toutes les 2500 entrées pour laisser respirer l'UI
      if (i > 0 && i % chunkSize === 0) {
        if (onChunkProgress) {
          onChunkProgress(Math.round((i / total) * 100));
        }
        await yieldToMain();
      }
    }

    if (batchToPersist.length > 0) {
      this.schedulePersist(batchToPersist);
    }
    return { added, updated };
  }

  /**
   * Version synchrone rétro-compatible
   */
  public importEntries(
    entries: DictionaryEntry[],
    origin: LearnedEntryMeta['origin'] = 'sst_import'
  ): { added: number; updated: number } {
    let added = 0;
    let updated = 0;
    const now = new Date().toISOString();
    const batchToPersist: Array<LearnedEntryMeta & { key: string }> = [];

    entries.forEach((e) => {
      const src = e.source?.trim();
      const tgt = e.target?.trim();
      if (src && tgt) {
        const key = src.toLowerCase();
        const existing = this.learnedEntriesMap.get(key);
        if (!existing) {
          const entry: LearnedEntryMeta & { key: string } = {
            key,
            source: src,
            target: tgt,
            game: e.game || 'Skyrim Special Edition',
            context: e.context,
            origin,
            addedAt: now,
            useCount: 1,
          };
          this.learnedEntriesMap.set(key, entry);
          batchToPersist.push(entry);
          added++;
        } else if (existing.target !== tgt && this.settings.overwritePreviousIfBetter) {
          const entry: LearnedEntryMeta & { key: string } = {
            key,
            source: src,
            target: tgt,
            game: e.game || existing.game,
            context: e.context || existing.context,
            origin,
            addedAt: now,
            useCount: (existing.useCount || 1) + 1,
          };
          this.learnedEntriesMap.set(key, entry);
          batchToPersist.push(entry);
          updated++;
        }
      }
    });

    if (batchToPersist.length > 0) {
      this.schedulePersist(batchToPersist);
    }
    return { added, updated };
  }

  /**
   * Renvoie la liste complète unifiée des dictionnaires pour traduction
   */
  public getUnifiedDictionary(): DictionaryEntry[] {
    const map = new Map<string, DictionaryEntry>();

    if (this.settings.priorityScanLocalFirst) {
      VANILLA_DICTIONARY.forEach((v) => {
        map.set(v.source.trim().toLowerCase(), v);
      });
      this.learnedEntriesMap.forEach((localEntry, key) => {
        map.set(key, {
          source: localEntry.source,
          target: localEntry.target,
          game: localEntry.game,
          context: localEntry.context ? `[Local Prioritaire] ${localEntry.context}` : '[Dictionnaire Local]',
        });
      });
    } else {
      this.learnedEntriesMap.forEach((localEntry, key) => {
        map.set(key, {
          source: localEntry.source,
          target: localEntry.target,
          game: localEntry.game,
          context: localEntry.context,
        });
      });
      VANILLA_DICTIONARY.forEach((v) => {
        const k = v.source.trim().toLowerCase();
        if (!map.has(k)) {
          map.set(k, v);
        }
      });
    }

    return Array.from(map.values());
  }

  /**
   * Recherche instantanée en O(1) stricte (100% exacte, aucun gel de l'UI)
   */
  public findExactTranslation(
    sourceText: string,
    gameEngine?: string
  ): { match: DictionaryEntry; isLocalLearned: boolean; matchType: 'exact'; similarity: number } | null {
    if (!sourceText) return null;
    const clean = sourceText.trim();
    if (!clean) return null;
    const key = clean.toLowerCase();

    // 1. SCAN PRIORITAIRE : Dictionnaire local auto-alimenté (100% exact en O(1))
    const localExact = this.learnedEntriesMap.get(key);
    if (localExact) {
      return {
        match: {
          source: localExact.source,
          target: localExact.target,
          game: localExact.game,
          context: localExact.context || '[Mémoire locale]',
        },
        isLocalLearned: true,
        matchType: 'exact',
        similarity: 100,
      };
    }

    // 2. SCAN SECONDAIRE : Vanilla exact en O(1)
    const vanillaExact = VANILLA_EXACT_MAP.get(key);
    if (vanillaExact) {
      return {
        match: vanillaExact,
        isLocalLearned: false,
        matchType: 'exact',
        similarity: 100,
      };
    }

    return null;
  }

  /**
   * Recherche instantanée avec scan prioritaire
   * allowFuzzy est par défaut à false pour éviter tout calcul Levenshtein intempestif
   */
  public findTranslation(
    sourceText: string,
    gameEngine?: string,
    allowFuzzy: boolean = false
  ): { match: DictionaryEntry; isLocalLearned: boolean; matchType: 'exact' | 'fuzzy'; similarity: number } | null {
    if (!sourceText) return null;

    // 1. Recherche exacte O(1) immédiate
    const exact = this.findExactTranslation(sourceText, gameEngine);
    if (exact) return exact;

    // Si la recherche floue n'est pas demandée, s'arrêter immédiatement (O(1))
    if (!allowFuzzy) return null;

    const clean = sourceText.trim();
    const cleanLen = clean.length;
    if (cleanLen < 3 || cleanLen > 140) return null;

    // 3. SCAN FLOU (Fuzzy match > 75%) : restreint aux entrées de longueur similaire pour rapidité
    let bestScore = 0;
    let bestLocal: LearnedEntryMeta | null = null;
    let localScanCount = 0;

    for (const item of this.learnedEntriesMap.values()) {
      // Heuristique de filtrage par taille pour éviter des millions de calculs de Levenshtein
      if (Math.abs(item.source.length - cleanLen) > Math.max(5, cleanLen * 0.25)) {
        continue;
      }
      const score = calculateSimilarity(item.source, clean);
      if (score > bestScore && score >= 75) {
        bestScore = score;
        bestLocal = item;
        if (score > 92) break; // Arrêt précoce sur excellent match
      }
      localScanCount++;
      if (localScanCount > 150) break; // Cap de sécurité anti-freeze
    }

    if (bestLocal && bestScore >= 75) {
      return {
        match: {
          source: bestLocal.source,
          target: bestLocal.target,
          game: bestLocal.game,
          context: bestLocal.context,
        },
        isLocalLearned: true,
        matchType: 'fuzzy',
        similarity: bestScore,
      };
    }

    // 4. Fuzzy match sur Vanilla (limité)
    let bestVanilla: DictionaryEntry | null = null;
    let vanillaScanCount = 0;
    for (const item of VANILLA_DICTIONARY) {
      if (Math.abs(item.source.length - cleanLen) > Math.max(5, cleanLen * 0.25)) {
        continue;
      }
      const score = calculateSimilarity(item.source, clean);
      if (score > bestScore && score >= 75) {
        bestScore = score;
        bestVanilla = item;
        if (score > 92) break;
      }
      vanillaScanCount++;
      if (vanillaScanCount > 80) break;
    }

    if (bestVanilla && bestScore >= 75) {
      return {
        match: bestVanilla,
        isLocalLearned: false,
        matchType: 'fuzzy',
        similarity: bestScore,
      };
    }

    return null;
  }

  /**
   * Statistiques globales du dictionnaire local
   */
  public getStats(): LocalDictionaryStats {
    const learnedCount = this.learnedEntriesMap.size;
    const gameCounts: Record<string, number> = {};

    // Calcul rapide des jeux
    let count = 0;
    for (const e of this.learnedEntriesMap.values()) {
      const g = e.game || 'Autre';
      gameCounts[g] = (gameCounts[g] || 0) + 1;
      count++;
      if (count > 50000) break; // Cap d'itération pour les stats instantanées
    }

    return {
      totalEntries: learnedCount + VANILLA_DICTIONARY.length,
      userLearnedEntries: learnedCount,
      vanillaEntries: VANILLA_DICTIONARY.length,
      lastUpdated: learnedCount > 0 ? 'Enregistré' : 'Jamais',
      gameCounts,
    };
  }

  /**
   * Récupère toutes les entrées apprises locales
   */
  public getLearnedEntries(): LearnedEntryMeta[] {
    return Array.from(this.learnedEntriesMap.values());
  }

  /**
   * Exporte le dictionnaire local au format JSON
   */
  public exportToJson(): string {
    const data = {
      app: 'mTRANSLATOR macOS',
      format: 'mTranslate_Local_Dictionary_DB',
      version: '2.0',
      exportedAt: new Date().toISOString(),
      stats: this.getStats(),
      entries: Array.from(this.learnedEntriesMap.values()),
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Supprime une entrée spécifique du dictionnaire local
   */
  public deleteEntry(source: string): boolean {
    const key = source.trim().toLowerCase();
    const removed = this.learnedEntriesMap.delete(key);
    if (removed) {
      idbAdapter.deleteKey(key).catch(() => {});
      this.schedulePersist();
    }
    return removed;
  }

  /**
   * Purge les données apprises (réinitialisation)
   */
  public clearLearned() {
    this.learnedEntriesMap.clear();
    try {
      localStorage.removeItem(STORAGE_KEY_CUSTOM_DICT);
      localStorage.removeItem(LEGACY_STORAGE_KEY_CUSTOM_DICT);
      localStorage.removeItem('mtranslator_custom_dictionaries');
      localStorage.removeItem('xtranslator_custom_dictionaries');
    } catch {}
    idbAdapter.clearAll().catch(() => {});
    this.notify();
  }

  /**
   * Remise à zéro complète : garantit une version 100% vierge de tout dictionnaire
   */
  public resetToCleanSlate() {
    this.clearLearned();
  }

  /**
   * Charge le jeu de dictionnaires de test (uniquement pour l'environnement de développement)
   */
  public loadDevTestDictionaries(): number {
    let count = 0;
    const now = new Date().toISOString();
    const toPersist: Array<LearnedEntryMeta & { key: string }> = [];

    DEV_TEST_DICTIONARIES.forEach((entry) => {
      if (!entry.source || !entry.target) return;
      const key = entry.source.trim().toLowerCase();
      const meta: LearnedEntryMeta & { key: string } = {
        key,
        source: entry.source.trim(),
        target: entry.target.trim(),
        game: entry.game || 'Skyrim Special Edition',
        context: entry.context || 'Test Dev',
        lang: entry.lang || 'fr',
        sourceLang: 'en',
        origin: 'dev_test',
        addedAt: now,
        useCount: 1,
      };
      this.learnedEntriesMap.set(key, meta);
      toPersist.push(meta);
      count++;
    });

    this.schedulePersist(toPersist);
    this.notify();
    return count;
  }

  /**
   * Crée un nouveau dictionnaire SST XML dans la langue spécifiée
   * et l'enregistre immédiatement dans la base active
   */
  public createSstDictionary(options: {
    name: string;
    game: string;
    sourceLang?: string;
    targetLang?: string;
    entries: Array<{ source: string; target: string; formId?: string; edid?: string; recordType?: string }>;
  }): { xml: string; addedCount: number } {
    const { name, game, sourceLang = 'English', targetLang = 'Français', entries } = options;
    const now = new Date().toISOString();
    const toPersist: Array<LearnedEntryMeta & { key: string }> = [];
    let addedCount = 0;

    entries.forEach((e) => {
      if (!e.source || !e.target) return;
      const key = e.source.trim().toLowerCase();
      const meta: LearnedEntryMeta & { key: string } = {
        key,
        source: e.source.trim(),
        target: e.target.trim(),
        game: game || 'Skyrim Special Edition',
        lang: targetLang,
        sourceLang,
        origin: 'created_sst',
        addedAt: now,
        useCount: 1,
      };
      this.learnedEntriesMap.set(key, meta);
      toPersist.push(meta);
      addedCount++;
    });

    if (toPersist.length > 0) {
      this.schedulePersist(toPersist);
      this.notify();
    }

    // Convert entries to ModRecord format for exportToSST
    const modRecords: ModRecord[] = entries.map((e, idx) => ({
      id: `new-sst-${idx}`,
      formId: e.formId || (idx + 1).toString(16).toUpperCase().padStart(8, '0'),
      edid: e.edid || `Record_${idx + 1}`,
      recordType: e.recordType || 'SST',
      source: e.source,
      target: e.target,
      status: 'translated',
      modified: false,
      validated: true,
    }));

    const xml = exportToSST(modRecords, game, sourceLang, targetLang);
    return { xml, addedCount };
  }
}

// Instance Singleton partagée dans toute l'application
export const localDictStore = new LocalDictionaryStore();
