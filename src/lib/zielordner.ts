// ============================================================
// Datei-Ziel für automatische Sicherungen (Teilgebietsdoku)
// ============================================================
//
// Der Browser darf Downloads nicht selbst in einen beliebigen Ordner legen.
// Über die File System Access API (Chrome/Edge) kann der Admin den Zielordner
// aber EINMAL auswählen — üblicherweise den lokal synchronisierten
// Google-Drive-Ordner („Google Drive“-Laufwerk / „Meine Ablage“) — danach
// schreibt die App jede Sicherung ohne weiteren Dialog direkt dorthin.
//
// Der gewählte Ordner wird als FileSystemDirectoryHandle in IndexedDB
// abgelegt (Handles sind strukturiert klonbar, aber nicht als JSON
// speicherbar — localStorage scheidet deshalb aus). Die Berechtigung hängt
// am Browser-Profil des Admins; nach einem Neustart fragt der Browser beim
// ersten Schreiben einmal nach (daher wird immer aus einem Klick heraus
// gesichert).
//
// Fehlt die API (Firefox/Safari) oder ist kein Ordner gewählt, fällt die App
// auf den normalen Browser-Download zurück — dann landet die Datei im
// Download-Ordner und muss von Hand ins Drive verschoben werden.

const DB_NAME = 'schlieper-dateiziel';
const DB_VERSION = 1;
const STORE = 'handles';
const KEY = 'teilgebietsdoku-ordner';

/** Minimal-Typen der File System Access API (nicht in allen TS-DOM-Libs). */
interface DirectoryHandleLike {
  name: string;
  queryPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  getFileHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<{ createWritable: () => Promise<WritableStreamLike> }>;
}
interface WritableStreamLike {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}

export function dateizielVerfuegbar(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function oeffneDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function lesenHandle(): Promise<DirectoryHandleLike | null> {
  try {
    const db = await oeffneDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as DirectoryHandleLike) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function schreibenHandle(handle: DirectoryHandleLike | null): Promise<void> {
  const db = await oeffneDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    if (handle) store.put(handle, KEY);
    else store.delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Name des hinterlegten Zielordners, oder null wenn keiner gewählt ist. */
export async function zielordnerName(): Promise<string | null> {
  const h = await lesenHandle();
  return h?.name ?? null;
}

/**
 * Zielordner auswählen (öffnet den Ordner-Dialog des Browsers). Muss aus
 * einem Klick heraus aufgerufen werden. Liefert den Ordnernamen oder null,
 * wenn der Dialog abgebrochen wurde.
 */
export async function waehleZielordner(): Promise<string | null> {
  if (!dateizielVerfuegbar()) return null;
  try {
    const picker = (window as unknown as {
      showDirectoryPicker: (opts?: { mode?: 'readwrite'; id?: string }) => Promise<DirectoryHandleLike>;
    }).showDirectoryPicker;
    const handle = await picker({ mode: 'readwrite', id: 'teilgebietsdoku' });
    const status = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (status !== 'granted') return null;
    await schreibenHandle(handle);
    return handle.name;
  } catch {
    // Abbruch im Dialog ist der Normalfall — kein Fehler.
    return null;
  }
}

export async function entferneZielordner(): Promise<void> {
  await schreibenHandle(null);
}

/**
 * Datei in den hinterlegten Zielordner schreiben. Liefert false, wenn kein
 * Ordner hinterlegt ist oder die Berechtigung fehlt — dann muss der Aufrufer
 * auf `browserDownload` ausweichen.
 */
export async function schreibeInZielordner(dateiname: string, blob: Blob): Promise<boolean> {
  const handle = await lesenHandle();
  if (!handle) return false;
  try {
    let status = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (status !== 'granted') {
      status = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    }
    if (status !== 'granted') return false;
    const datei = await handle.getFileHandle(dateiname, { create: true });
    const writable = await datei.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (e) {
    console.warn('Schreiben in den Zielordner fehlgeschlagen:', e);
    return false;
  }
}

/** Klassischer Browser-Download (Fallback ohne Zielordner). */
export function browserDownload(dateiname: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  a.click();
  URL.revokeObjectURL(url);
}
