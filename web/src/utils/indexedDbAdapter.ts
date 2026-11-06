/**
 * Moteur de persistance IndexedDB asynchrone haute capacité pour mTRANSLATOR
 * Supporte des centaines de milliers d'entrées sans limitation de quota de 5Mo ni blocage synchrone du thread UI.
 */

import { LearnedEntryMeta } from './localDictionaryStore';
import { L } from '../i18n/L';

// Base actuelle (v3) : clé courte (empreinte du texte source), aucun index.
// L'ancienne base (v2) prenait la source entière comme clé et l'indexait trois fois (index jamais lus) :
// chaque texte y était recopié environ six fois (1,1 Go pour 23 000 entrées). Elle est recopiée dans la v3
// au premier lancement, puis supprimée (la suppression de la base libère réellement la place sur le disque).
const DB_NAME = 'mTranslator_DB_v3';
const LEGACY_DB_NAME = 'mTranslator_DB_v2';  // ancienne base, migrée puis supprimée
const DB_VERSION = 1;
const STORE_LEARNED = 'learned_entries';

/** Empreinte de 106 bits (deux cyrb53) de la clé d'origine (source en minuscules) : identifiant court. */
export function shortKey(key: string): string {
  const h = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < key.length; i++) {
      const c = key.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  return h(1) + '.' + h(2);
}

/** Entrée telle qu'elle est rangée : sans le champ `key` (la clé est hors de l'objet). */
function stored(e: any): any {
  const { key: _key, ...rest } = e;
  return rest;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction annulée'));
  });
}

function openDb(name: string, version?: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? window.indexedDB.open(name) : window.indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade && upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function legacyExists(): Promise<boolean> {
  const idb: any = window.indexedDB;
  if (typeof idb.databases === 'function') {
    const list: Array<{ name?: string }> = await idb.databases();
    return list.some((d) => d.name === LEGACY_DB_NAME);
  }
  return true;  // sans databases() : on ouvre pour voir (une base vide créée par erreur est supprimée plus bas)
}

/**
 * Recopie l'ancienne base dans la nouvelle, vérifie le nombre d'entrées, puis supprime l'ancienne.
 * Sûre si elle est interrompue : l'ancienne base n'est supprimée qu'après l'écriture complète et vérifiée
 * de la nouvelle ; sinon tout recommence au lancement suivant.
 */
async function migrateLegacy(db: IDBDatabase): Promise<void> {
  if (!(await legacyExists())) return;
  const old = await openDb(LEGACY_DB_NAME);
  let rows: any[] = [];
  try {
    if (old.objectStoreNames.contains(STORE_LEARNED)) {
      rows = await promisify(old.transaction(STORE_LEARNED, 'readonly').objectStore(STORE_LEARNED).getAll());
    }
  } finally {
    old.close();
  }
  if (rows.length > 0) {
    const tx = db.transaction(STORE_LEARNED, 'readwrite');
    const store = tx.objectStore(STORE_LEARNED);
    const keys = new Set<string>();
    for (const r of rows) {
      const k = shortKey(String(r.key ?? String(r.source ?? '').trim().toLowerCase()));
      keys.add(k);
      store.put(stored(r), k);
    }
    await txDone(tx);
    const count = await promisify(db.transaction(STORE_LEARNED, 'readonly').objectStore(STORE_LEARNED).count());
    if (count < keys.size) throw new Error(`migration incomplète : ${count} / ${keys.size} entrées`);
  }
  await new Promise<void>((resolve, reject) => {
    const req = window.indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();  // supprimée dès que plus rien ne la tient ouverte
  });
}

class IndexedDbAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private legacyPending = false;  // migration échouée : l'ancienne base est encore lue en plus de la nouvelle

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = (async () => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        throw new Error(L("IndexedDB non disponible dans cet environnement"));
      }
      const db = await openDb(DB_NAME, DB_VERSION, (d) => {
        if (!d.objectStoreNames.contains(STORE_LEARNED)) d.createObjectStore(STORE_LEARNED);
      });
      try {
        await migrateLegacy(db);
      } catch (e) {
        this.legacyPending = true;
        console.warn('Migration du dictionnaire (ancienne base conservée) :', e);
      }
      return db;
    })();

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

        req.onsuccess = async () => {
          const results: any[] = req.result || [];
          if (this.legacyPending) {
            try {
              const old = await openDb(LEGACY_DB_NAME);
              if (old.objectStoreNames.contains(STORE_LEARNED)) {
                results.push(...(await promisify(old.transaction(STORE_LEARNED, 'readonly').objectStore(STORE_LEARNED).getAll())));
              }
              old.close();
            } catch {}
          }
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
          store.put(stored(entries[i]), shortKey(entries[i].key));
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
        const req = store.delete(shortKey(key));
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
