// スマホの中の保存場所（IndexedDB）。外には何も送らない
// - shelter：シェルター情報（1件だけ）
// - cats：猫の名簿
// - events：譲渡会
// - drafts：入力の途中（LINEに移ってページが読み込み直されても消えないように）
import type { AdoptionEvent, Cat, Shelter } from './types'

const DB_NAME = 'hogoneko-card'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('shelter')) db.createObjectStore('shelter')
      if (!db.objectStoreNames.contains('cats')) db.createObjectStore('cats', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

type StoreName = 'shelter' | 'cats' | 'events' | 'drafts'

async function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest | void,
): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    tx.oncomplete = () => resolve((req ? req.result : undefined) as T)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// 写真・ロゴは、Blobのままではなく「中身のバイト列（ArrayBuffer）＋種類」にして保存する。
// Safari（WebKit）は、プライベートに近い状態だと Blob を保存できなかったため（DEVLOG 11/4）
type StoredBlob = { __blob: true; type: string; data: ArrayBuffer }

async function pack(b: Blob): Promise<StoredBlob> {
  return { __blob: true, type: b.type, data: await b.arrayBuffer() }
}
const unpack = (s: StoredBlob | Blob): Blob =>
  s instanceof Blob ? s : new Blob([s.data], { type: s.type })

type Stored<T, K extends keyof T> = Omit<T, K> & Record<K, unknown>

// 写真などのファイルは、選んだ直後に中身を写しておく。
// iPhoneでは、選んだファイルが一時的な場所にあり、あとで読めなくなることがあるため
export async function copyBlob(file: Blob): Promise<Blob> {
  return new Blob([await file.arrayBuffer()], { type: file.type || 'image/jpeg' })
}

// シェルター
export async function loadShelter(): Promise<Shelter | undefined> {
  const s = await run<Stored<Shelter, 'logo'> | undefined>('shelter', 'readonly', (st) => st.get('main'))
  return s && { ...s, logo: s.logo ? unpack(s.logo as StoredBlob) : null }
}
export async function saveShelter(shelter: Shelter) {
  const stored = { ...shelter, logo: shelter.logo ? await pack(shelter.logo) : null }
  await run<void>('shelter', 'readwrite', (s) => s.put(stored, 'main'))
}

// 猫の名簿
type StoredCat = Stored<Cat, 'photos' | 'clip'>
async function packCat(cat: Cat): Promise<StoredCat> {
  return {
    ...cat,
    photos: await Promise.all(cat.photos.map(pack)),
    clip: cat.clip && { ...cat.clip, blob: await pack(cat.clip.blob) },
  }
}
function unpackCat(c: StoredCat): Cat {
  const clip = c.clip as (Omit<NonNullable<Cat['clip']>, 'blob'> & { blob: StoredBlob }) | null
  return {
    ...c,
    photos: (c.photos as StoredBlob[]).map(unpack),
    clip: clip && { ...clip, blob: unpack(clip.blob) },
  }
}
export const loadCats = async () => {
  const cats = await run<StoredCat[]>('cats', 'readonly', (s) => s.getAll())
  return cats.map(unpackCat).sort((a, b) => b.updatedAt - a.updatedAt)
}
export async function saveCat(cat: Cat) {
  const stored = await packCat(cat)
  await run<void>('cats', 'readwrite', (s) => s.put(stored))
}
export const deleteCat = (id: string) => run<void>('cats', 'readwrite', (s) => s.delete(id))

// 譲渡会（画面は11/6）
export const loadEvents = () => run<AdoptionEvent[]>('events', 'readonly', (s) => s.getAll())
export const saveEvent = (e: AdoptionEvent) => run<void>('events', 'readwrite', (s) => s.put(e))

// 入力の途中。写真は大きいので、文字とは別に、変わったときだけ書く
export type Draft = {
  cat: Omit<Cat, 'photos'>
  fromRoster: boolean // 名簿から選んだ子か
  screen: 'cat' | 'preview'
  post: string
}
export const loadDraft = async (): Promise<{ draft: Draft; photos: Blob[] } | null> => {
  const draft = await run<Draft | undefined>('drafts', 'readonly', (s) => s.get('main'))
  if (!draft) return null
  const photos = (await run<StoredBlob[] | undefined>('drafts', 'readonly', (s) => s.get('photos'))) ?? []
  return { draft, photos: photos.map(unpack) }
}
// 途中の動画は11/5（つまみと一緒に）。今は文字だけ
export const saveDraft = (draft: Draft) =>
  run<void>('drafts', 'readwrite', (s) => s.put({ ...draft, cat: { ...draft.cat, clip: null } }, 'main'))
export async function saveDraftPhotos(photos: Blob[]) {
  const stored = await Promise.all(photos.map(pack))
  await run<void>('drafts', 'readwrite', (s) => s.put(stored, 'photos'))
}
export const clearDraft = () => run<void>('drafts', 'readwrite', (s) => s.clear())

// 「消えにくくしてほしい」とお願いする。通るかはブラウザが決める
export async function requestPersist(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

export async function isPersisted(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null
    return await navigator.storage.persisted()
  } catch {
    return null
  }
}
