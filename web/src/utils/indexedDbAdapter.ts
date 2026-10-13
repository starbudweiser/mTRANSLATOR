/**
 * Moteur de persistance IndexedDB asynchrone haute capacité pour mTRANSLATOR
 * Supporte des centaines de milliers d'entrées sans limitation de quota de 5Mo ni blocage synchrone du thread UI.
 */

import { LearnedEntryMeta } from './localDictionaryStore';

const DB_NAME = 'mTranslator_DB_v2';  // nom historique : ne pas renommer (données des utilisateurs)
const DB_VERSION = 1;
const STORE_LEARNED = 'learned_entries';

class IndexedDbAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB non disponible dans cet environnement'));
      }

      const req = window.indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_LEARNED)) {
          const store = db.createObjectStore(STORE_LEARNED, { keyPath: 'key' });
          store.createIndex('source', 'source', { unique: false });
          store.createIndex('game', 'game', { unique: false });
          store.createIndex('addedAt', 'addedAt', { unique: false });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }

  /**
   * Récupère toutes les entrées apprises stockées
   */
  public async getAll(): Promise<LearnedEntryMeta[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_LEARNED, 'readonly');
        const store = tx.objectStore(STORE_LEARNED);
        const req = store.getAll();

        req.onsuccess = () => {
          const results: any[] = req.result || [];
          resolve(results.map((r) => ({
            source: r.source,
            target: r.target,
            game: r.game,
            context: r.context,
            origin: r.origin,
            addedAt: r.addedAt,
            useCount: r.useCount,
          })));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  /**
   * Sauvegarde un lot d'entrées de manière asynchrone par transaction groupée
   */
  public async putBatch(entries: Array<LearnedEntryMeta & { key: string }>): Promise<void> {
    if (entries.length === 0) return;
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_LEARNED, 'readwrite');
        const store = tx.objectStore(STORE_LEARNED);

        for (let i = 0; i < entries.length; i++) {
          store.put(entries[i]);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('Erreur sauvegarde IndexedDB:', e);
    }
  }

  /**
   * Supprime une entrée par sa clé
   */
  public async deleteKey(key: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_LEARNED, 'readwrite');
        const store = tx.objectStore(STORE_LEARNED);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {}
  }

  /**
   * Purge tout le magasin
   */
  public async clearAll(): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_LEARNED, 'readwrite');
        const store = tx.objectStore(STORE_LEARNED);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {}
  }
}

export const idbAdapter = new IndexedDbAdapter();
