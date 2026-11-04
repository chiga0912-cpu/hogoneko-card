// スマホの中の保存場所（IndexedDB）。外には何も送らない
// - shelter：シェルター情報（1件だけ）
// - cats：猫の名簿
// - events：譲渡会
// - drafts：入力の途中（LINEに移ってページが読み込み直されても消えないように）
import {
  AGE_STAGES,
  NEUTERS,
  SEXES,
  VACCINES,
  VIRUS_TESTS,
  emptyShelter,
  newCat,
  type AdoptionEvent,
  type Age,
  type Cat,
  type Health,
  type Shelter,
} from './types'

const DB_NAME = 'hogoneko-card'
const DB_VERSION = 1

// 保存する記録の形の版。11/4に公開した最初の形には、この番号がない（＝0として読む）。
// 形を変えたら番号を上げ、読むときに足りない項目を最初の値で埋める（下の normalize…）
export const SCHEMA_VERSION = 1

// 保存場所そのものが開けなかったとき（読み込みの失敗とは分けて知らせるため）
export class OpenError extends Error {}

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
      reject(new OpenError(String(req.error)))
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

// ---- 読むときに形をそろえる（古い形・壊れた形でも、アプリが止まらないように）----
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  list.includes(v as T) ? (v as T) : d
function blobOrNull(v: unknown): Blob | null {
  if (v instanceof Blob) return v
  if (isObj(v) && v.__blob === true && v.data instanceof ArrayBuffer) return unpack(v as StoredBlob)
  return null
}
const health = <T extends string>(v: unknown, list: readonly T[]): Health<T> =>
  isObj(v) ? { value: oneOf(v.value, list, '未確認' as T), show: v.show === true } : { value: '未確認' as T, show: false }
function age(v: unknown): Age {
  if (!isObj(v)) return { mode: 'unknown' }
  const mode = oneOf(v.mode, ['unknown', 'birth', 'stage'] as const, 'unknown')
  const a: Age = { mode }
  if (typeof v.birthYear === 'number') a.birthYear = v.birthYear
  if (typeof v.birthMonth === 'number') a.birthMonth = v.birthMonth
  if (typeof v.estimated === 'boolean') a.estimated = v.estimated
  if (AGE_STAGES.includes(v.stage as never)) a.stage = v.stage as Age['stage']
  return a
}

// 猫1匹分。id がない・形がまったく違うときは null（＝読めなかった子。消さずに残す）
function normalizeCat(raw: unknown, photos: Blob[] | null): Cat | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const d = newCat()
  const clipRaw = raw.clip
  const clipBlob = isObj(clipRaw) ? blobOrNull(clipRaw.blob) : null
  return {
    ...d,
    id: raw.id,
    createdAt: num(raw.createdAt, d.createdAt),
    updatedAt: num(raw.updatedAt, num(raw.createdAt, 0)),
    photos:
      photos ??
      (Array.isArray(raw.photos) ? raw.photos.map(blobOrNull).filter((b): b is Blob => b !== null) : []),
    clip:
      isObj(clipRaw) && clipBlob
        ? { blob: clipBlob, start: num(clipRaw.start, 0), length: num(clipRaw.length, 5) }
        : null,
    framing: isObj(raw.framing) ? (raw.framing as Cat['framing']) : {},
    textPosition: oneOf(raw.textPosition, ['up', 'normal', 'down'] as const, 'normal'),
    memo: str(raw.memo),
    memoAdditions: str(raw.memoAdditions),
    name: str(raw.name),
    age: age(raw.age),
    sex: oneOf(raw.sex, SEXES, '未確認'),
    vaccine: health(raw.vaccine, VACCINES),
    neuter: health(raw.neuter, NEUTERS),
    virusTest: health(raw.virusTest, VIRUS_TESTS),
    healthCheckedAt: typeof raw.healthCheckedAt === 'string' ? raw.healthCheckedAt : null,
    goodPoints: strs(raw.goodPoints),
    cardLines: strs(raw.cardLines),
    carerWords: str(raw.carerWords),
    sources: isObj(raw.sources) ? (raw.sources as Cat['sources']) : {},
  }
}

function normalizeShelter(raw: unknown): Shelter | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isObj(raw)) throw new Error('シェルター情報の形が読めません')
  const d = emptyShelter()
  return {
    name: str(raw.name),
    themeColor: /^#[0-9a-fA-F]{6}$/.test(str(raw.themeColor)) ? str(raw.themeColor) : d.themeColor,
    logo: blobOrNull(raw.logo),
    contact: str(raw.contact),
    fixedText: str(raw.fixedText),
    hashtags: strs(raw.hashtags),
    venues: strs(raw.venues),
  }
}

type Stored<T, K extends keyof T> = Omit<T, K> & Record<K, unknown>

// 写真などのファイルは、選んだ直後に中身を写しておく。
// iPhoneでは、選んだファイルが一時的な場所にあり、あとで読めなくなることがあるため
export async function copyBlob(file: Blob): Promise<Blob> {
  return new Blob([await file.arrayBuffer()], { type: file.type || 'image/jpeg' })
}

// シェルター
export async function loadShelter(): Promise<Shelter | undefined> {
  return normalizeShelter(await run<unknown>('shelter', 'readonly', (st) => st.get('main')))
}
export async function saveShelter(shelter: Shelter) {
  const stored = { ...shelter, logo: shelter.logo ? await pack(shelter.logo) : null, schemaVersion: SCHEMA_VERSION }
  await run<void>('shelter', 'readwrite', (s) => s.put(stored, 'main'))
}

// 猫の名簿
type StoredCat = Stored<Cat, 'photos' | 'clip'>
async function packCat(cat: Cat): Promise<StoredCat & { schemaVersion: number }> {
  return {
    ...cat,
    schemaVersion: SCHEMA_VERSION,
    photos: await Promise.all(cat.photos.map(pack)),
    clip: cat.clip && { ...cat.clip, blob: await pack(cat.clip.blob) },
  }
}
// 名簿を読む。読めなかった子は飛ばして数だけ返す（保存場所からは消さない）
export const loadCats = async (): Promise<{ cats: Cat[]; unreadable: number }> => {
  const raws = await run<unknown[]>('cats', 'readonly', (s) => s.getAll())
  const cats: Cat[] = []
  let unreadable = 0
  for (const raw of raws) {
    let c: Cat | null = null
    try {
      c = normalizeCat(raw, null)
    } catch {
      c = null
    }
    if (c) cats.push(c)
    else unreadable++
  }
  return { cats: cats.sort((a, b) => b.updatedAt - a.updatedAt), unreadable }
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
  postEdited: boolean // 投稿文を手で直したか（直していたら、作り直す前に聞く）
}
// 入力の途中を読む。読めないときは 'unreadable'（途中は消さない。新しく始めたときに上書きされる）
export const loadDraft = async (): Promise<{ cat: Cat; draft: Draft } | null | 'unreadable'> => {
  try {
    const raw = await run<unknown>('drafts', 'readonly', (s) => s.get('main'))
    if (raw === undefined) return null
    if (!isObj(raw)) return 'unreadable'
    const rawPhotos = await run<unknown>('drafts', 'readonly', (s) => s.get('photos'))
    const photos = Array.isArray(rawPhotos)
      ? rawPhotos.map(blobOrNull).filter((b): b is Blob => b !== null)
      : []
    const cat = normalizeCat(raw.cat, photos)
    if (!cat) return 'unreadable'
    const { photos: _p, ...rest } = cat
    return {
      cat,
      draft: {
        cat: rest,
        fromRoster: raw.fromRoster === true,
        screen: oneOf(raw.screen, ['cat', 'preview'] as const, 'cat'),
        post: str(raw.post),
        postEdited: raw.postEdited === true,
      },
    }
  } catch (e) {
    if (e instanceof OpenError) throw e
    return 'unreadable'
  }
}
// 途中の動画は11/5（つまみと一緒に）。今は文字だけ
export const saveDraft = (draft: Draft) =>
  run<void>('drafts', 'readwrite', (s) =>
    s.put({ ...draft, cat: { ...draft.cat, clip: null }, schemaVersion: SCHEMA_VERSION }, 'main'),
  )
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
