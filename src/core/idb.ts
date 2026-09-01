/**
 * A very small IndexedDB wrapper.
 *
 * `chrome.storage.local` caps out around ten megabytes, and Codeforces'
 * problemset alone is several — nine and a half thousand problems with their
 * tags. Bulk caches therefore live here instead, and `chrome.storage.local`
 * keeps what the panel reads synchronously: settings, and the problem records.
 *
 * Deliberately not a library. Three operations are needed — get a value, put a
 * value, drop a store — and a dependency for that is a dependency to keep
 * working forever.
 */

const DB_NAME = 'redo';
const DB_VERSION = 1;

/** Every store the database holds. Adding one means bumping `DB_VERSION`. */
export const STORES = {
  /** Codeforces' problemset, keyed by `<contestId><index>`. */
  cfProblems: 'cfProblems',
  /** Per-handle submission summaries, keyed by the lower-cased handle. */
  cfStatus: 'cfStatus',
  /** Small bookkeeping values — when each cache was last filled. */
  meta: 'meta',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let opening: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // A second tab upgrading the schema would otherwise leave this handle
      // pinned to the old version and block it forever.
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };

    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open.'));
  });

  return opening.catch((error) => {
    // A failed open must not poison every later call — private windows and
    // wiped profiles both produce one, and both recover on a retry.
    opening = undefined;
    throw error;
  });
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = action(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${mode} failed.`));
      }),
  );
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (objects) => objects.get(key));
}

export async function idbPut(store: StoreName, key: string, value: unknown): Promise<void> {
  await run(store, 'readwrite', (objects) => objects.put(value, key));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  await run(store, 'readwrite', (objects) => objects.delete(key));
}

export async function idbClear(store: StoreName): Promise<void> {
  await run(store, 'readwrite', (objects) => objects.clear());
}

/**
 * Asks the browser to keep this data rather than evicting it under pressure.
 *
 * Best-effort by design: Chrome grants it silently for installed extensions and
 * the caches rebuild from the API if it ever says no, so a refusal is not worth
 * reporting.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
