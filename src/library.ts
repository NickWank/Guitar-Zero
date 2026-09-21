/** IndexedDB-backed store for uploaded songs, so they persist across reloads. */
import type { ChartNote, ChartSong, Difficulty } from "./chart";

export interface LibrarySongMeta {
  id: string;
  name: string;
  artist: string;
  addedAt: number;
}

export interface LibrarySong extends LibrarySongMeta {
  mp3: Blob;
  song: ChartSong;
  notesByDifficulty: Record<Difficulty, ChartNote[]>;
}

const DB_NAME = "guitar-zero-library";
const DB_VERSION = 1;
const STORE_NAME = "songs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addLibrarySong(
  name: string,
  artist: string,
  mp3: Blob,
  song: ChartSong,
  notesByDifficulty: Record<Difficulty, ChartNote[]>,
): Promise<string> {
  const db = await openDB();
  const id = crypto.randomUUID();
  const record: LibrarySong = { id, name, artist, addedAt: Date.now(), mp3, song, notesByDifficulty };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return id;
}

export async function listLibrarySongs(): Promise<LibrarySongMeta[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const songs = (request.result as LibrarySong[]).map(({ id, name, artist, addedAt }) => ({
        id,
        name,
        artist,
        addedAt,
      }));
      resolve(songs);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getLibrarySong(id: string): Promise<LibrarySong> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      if (!request.result) reject(new Error(`No library song with id ${id}`));
      else resolve(request.result as LibrarySong);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteLibrarySong(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
