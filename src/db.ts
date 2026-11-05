// スマホの中の保存場所（IndexedDB）。外には何も送らない
// - shelter：シェルター情報（1件だけ）
// - cats：猫の名簿
// - events：譲渡会
// - drafts：入力の途中（LINEに移ってページが読み込み直されても消えないように）
// - catMedia：猫の写真と撮った動画（版2から。名簿の一覧を開くたびに全員分の写真を読まないように、cats から分けた）
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
// 保存場所そのものの番号。2で catMedia を足した（中身の移し替えは、ここではしない。下の migrateCat）
const DB_VERSION = 2

// 保存する記録の形の版。11/4に公開した最初の形には、この番号がない（＝0として読む）。
// 形を変えたら番号を上げ、読むときに足りない項目を最初の値で埋める（下の normalize…）
// 版2：猫の写真と動画を catMedia に分け、cats には小さな表紙（cover）だけを残す。版0・1の子は写真が cats の中にある
export const SCHEMA_VERSION = 2

// 保存場所そのものが開けなかったとき（読み込みの失敗とは分けて知らせるため）
export class OpenError extends Error {}

// 古い版のタブが開いたままで、保存場所の番号を上げられないとき。そのタブが閉じられると、待っていた続きが動く
let blockedListener: ((blocked: boolean) => void) | null = null
export const onBlocked = (fn: (blocked: boolean) => void) => {
  blockedListener = fn
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    // ここでは置き場所を作るだけ。中身は動かさない（写真の表紙づくりは待ち時間があり、この中ではできないため）
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('shelter')) db.createObjectStore('shelter')
      if (!db.objectStoreNames.contains('cats')) db.createObjectStore('cats', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts')
      if (!db.objectStoreNames.contains('catMedia')) db.createObjectStore('catMedia')
    }
    req.onblocked = () => blockedListener?.(true)
    req.onsuccess = () => {
      blockedListener?.(false)
      const db = req.result
      // もっと新しい版がこの先に開かれたら、こちらは閉じて道をあける（相手が止まらないように。見直し A16）
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(new OpenError(String(req.error)))
    }
  })
  return dbPromise
}

type StoreName = 'shelter' | 'cats' | 'events' | 'drafts' | 'catMedia'

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

// いくつかの置き場所にまとめて書く。途中で1つでも失敗したら、全部を取り消す（中途半端な形を残さない）。
// body の中では await を使わない（待つと、書き込みが途中で確定してしまうため）。続きは要求の onsuccess に書き、
// その中で失敗したら fail を呼ぶ
async function inTx(
  stores: StoreName[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction, fail: (e: unknown) => void) => void,
): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    let failure: unknown = null
    let tx: IDBTransaction
    try {
      tx = db.transaction(stores, mode)
    } catch (e) {
      reject(e)
      return
    }
    const fail = (e: unknown) => {
      failure ??= e ?? new Error('書き込みに失敗しました')
      try {
        tx.abort()
      } catch {
        // もう終わっていたときは何もしない（onabort / onerror で知らせが届く）
      }
    }
    tx.oncomplete = () => (failure ? reject(failure) : resolve())
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('書き込みを取り消しました'))
    try {
      body(tx, fail)
    } catch (e) {
      fail(e)
    }
  })
}
// 要求の続き（onsuccess）で失敗しても、まとめて取り消す
const then = <T>(req: IDBRequest<T>, fail: (e: unknown) => void, next: (v: T) => void) => {
  req.onsuccess = () => {
    try {
      next(req.result)
    } catch (e) {
      fail(e)
    }
  }
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

const blobs = (v: unknown): Blob[] => (Array.isArray(v) ? v.map(blobOrNull).filter((b): b is Blob => b !== null) : [])
// 最初の読める1枚だけ（一覧の表紙のため。全部を Blob に戻さない）
function firstBlob(v: unknown): Blob | null {
  if (!Array.isArray(v)) return null
  for (const x of v) {
    const b = blobOrNull(x)
    if (b) return b
  }
  return null
}
function clipOf(clipRaw: unknown): Cat['clip'] {
  const clipBlob = isObj(clipRaw) ? blobOrNull(clipRaw.blob) : null
  return isObj(clipRaw) && clipBlob
    ? { blob: clipBlob, start: num(clipRaw.start, 0), length: num(clipRaw.length, 5) }
    : null
}

// 写真が catMedia に分けてある記録か（版2から）。版0・1は写真が記録の中にある
const isSplit = (raw: Record<string, unknown>) => typeof raw.schemaVersion === 'number' && raw.schemaVersion >= 2

// 猫1匹分。id がない・形がまったく違うときは null（＝読めなかった子。消さずに残す）
// media：catMedia から読んだ写真と動画（そのままの形）。なければ記録の中のものを使う（版0・1）
function normalizeCat(raw: unknown, media?: { photos: unknown; clip: unknown }): Cat | null {
  const base = normalizeCatText(raw)
  if (!base || !isObj(raw)) return null
  const m = media ?? { photos: raw.photos, clip: raw.clip }
  return { ...base, photos: blobs(m.photos), clip: clipOf(m.clip) }
}

// 名簿の一覧に出す1匹分。写真と動画は持たず、小さな表紙だけ。
// カード・動画には使えないように、Cat とは別の形にしてある（表紙は小さく、カードに使うとぼやけるため）
export type CatSummary = Omit<Cat, 'photos' | 'clip'> & {
  cover: Blob | null
  oldShape: boolean // 写真がまだ記録の中にある（移し替えがまだ）
}
function normalizeSummary(raw: unknown): CatSummary | null {
  const base = normalizeCatText(raw)
  if (!base || !isObj(raw)) return null
  const split = isSplit(raw)
  // 移し替えの前の子は、1枚目の写真をそのまま表紙にする（移し替えのときに小さな表紙を作る）
  const cover = split ? blobOrNull(raw.cover) : firstBlob(raw.photos)
  return { ...base, cover, oldShape: !split }
}

function normalizeCatText(raw: unknown): Omit<Cat, 'photos' | 'clip'> | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const d = newCat()
  return {
    id: raw.id,
    createdAt: num(raw.createdAt, d.createdAt),
    updatedAt: num(raw.updatedAt, num(raw.createdAt, 0)),
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
// 版2の形：cats には文字と小さな表紙（cover）、catMedia（鍵は猫の id）には写真と動画
type StoredMedia = { schemaVersion: number; photos: unknown; clip: unknown }

// 名簿の一覧を読む。写真と動画は読まない（catMedia には触らない）。
// 移し替えの前の子（版0・1）は、記録の中の1枚目の写真を表紙にする。読めなかった子は飛ばして数だけ返す（消さない）
// 1匹ずつ読む（全員分を一度に読むと、古い形の名簿では写真も全部いっぺんに広がり、重くなるため）
export async function loadCats(): Promise<{ cats: CatSummary[]; unreadable: number }> {
  const cats: CatSummary[] = []
  let unreadable = 0
  await inTx(['cats'], 'readonly', (tx, fail) => {
    const req = tx.objectStore('cats').openCursor()
    req.onerror = () => fail(req.error)
    req.onsuccess = () => {
      const cur = req.result
      if (!cur) return
      let c: CatSummary | null = null
      try {
        c = normalizeSummary(cur.value)
      } catch {
        c = null
      }
      if (c) cats.push(c)
      else unreadable++
      cur.continue()
    }
  })
  return { cats: cats.sort((a, b) => b.updatedAt - a.updatedAt), unreadable }
}

// 写真が読めなかったとき（名簿は消していない。入力画面は開かない）
export class MediaError extends Error {}

// 名簿から選んだ1匹を、写真と動画も含めて読む。カード・動画には、ここで読んだ元の写真を使う
export async function loadCat(id: string): Promise<Cat> {
  let raw: unknown
  let media: unknown
  try {
    await inTx(['cats', 'catMedia'], 'readonly', (tx, fail) => {
      then(tx.objectStore('cats').get(id), fail, (r) => (raw = r))
      then(tx.objectStore('catMedia').get(id), fail, (m) => (media = m))
    })
  } catch (e) {
    if (e instanceof OpenError) throw e
    throw new MediaError(String(e))
  }
  if (!isObj(raw)) throw new MediaError('名簿の記録が見つかりません')
  let cat: Cat | null
  if (isSplit(raw)) {
    // 写真の記録がないまま開くと、保存したときに写真のない子になってしまう。開かずに知らせる
    if (!isObj(media)) throw new MediaError('写真の記録が見つかりません')
    cat = normalizeCat(raw, { photos: media.photos, clip: media.clip })
  } else {
    // 古い形なのに、新しい置き場所にも写真がある子（古い版に戻して保存し直したあとなど）。
    // どちらが正しいか分からないので開かない（開いて保存すると、もう片方を上書きしてしまうため）
    if (media !== undefined) throw new MediaError('写真が2か所にあります')
    cat = normalizeCat(raw)
  }
  if (!cat) throw new MediaError('名簿の記録が読めません')
  return cat
}

// 保存する。表紙（cover）は呼ぶ側で作って渡す（写真から小さく作る。lib/shrink.ts の makeCover）。
// 写真と記録は、1回の書き込みで両方書く（片方だけ残らないように）
export async function saveCat(cat: Cat, cover: Blob | null) {
  const { photos, clip, ...text } = cat
  const media: StoredMedia = {
    schemaVersion: SCHEMA_VERSION,
    photos: await Promise.all(photos.map(pack)),
    clip: clip && { ...clip, blob: await pack(clip.blob) },
  }
  const record = { ...text, cover: cover ? await pack(cover) : null, schemaVersion: SCHEMA_VERSION }
  await inTx(['cats', 'catMedia'], 'readwrite', (tx) => {
    tx.objectStore('catMedia').put(media, cat.id)
    tx.objectStore('cats').put(record)
  })
}
// 名簿から消す。記録と写真を、1回で両方消す
export const deleteCat = (id: string) =>
  inTx(['cats', 'catMedia'], 'readwrite', (tx) => {
    tx.objectStore('catMedia').delete(id)
    tx.objectStore('cats').delete(id)
  })

// ---- 古い形（版0・1）の子を、版2の形に移す ----
// 1匹ずつ。何度やり直してもよい（もう版2の子・消された子は、何もしない）

// 1匹を移す。書き込みの中で記録を読み直し、まだ古い形のときだけ移す（その間に保存・削除されていたら何もしない）。
// 写真と動画は、読めないものも含めて、形を変えずにそのまま catMedia に移す（移すときに捨てない）。
// 順番は「catMedia に書く → cats の記録から写真を外す」。どちらかが失敗したら両方取り消す（元の形のまま残る）
export async function migrateCat(id: string, cover: Blob | null): Promise<'moved' | 'skipped'> {
  const packedCover = cover ? await pack(cover) : null
  let result: 'moved' | 'skipped' = 'skipped'
  await inTx(['cats', 'catMedia'], 'readwrite', (tx, fail) => {
    const cats = tx.objectStore('cats')
    then(cats.get(id), fail, (raw) => {
      if (!isObj(raw) || isSplit(raw)) return
      // この子の写真が、もう catMedia にあるときは上書きしない（古い版に戻して保存し直したあとなど）。
      // どちらの写真が正しいか分からないので、両方そのまま残し、「移せなかった」に数える
      then(tx.objectStore('catMedia').getKey(id), fail, (existing) => {
        if (existing !== undefined) {
          fail(new Error('この子の写真が、もう別の置き場所にあります'))
          return
        }
        const { photos, clip, ...text } = raw
        const media: StoredMedia = { schemaVersion: SCHEMA_VERSION, photos: photos ?? [], clip: clip ?? null }
        const putMedia = tx.objectStore('catMedia').put(media, id)
        putMedia.onerror = () => fail(putMedia.error)
        then(putMedia, fail, () => {
          const putCat = cats.put({ ...text, cover: packedCover, schemaVersion: SCHEMA_VERSION })
          putCat.onerror = () => fail(putCat.error)
          then(putCat, fail, () => {
            result = 'moved'
          })
        })
      })
    })
  })
  return result
}

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
// photosMissing：途中の写真がまだ書かれていなかった（文字は書けたが、写真を書く前にページが終わったときなど）
export const loadDraft = async (): Promise<{ cat: Cat; draft: Draft; photosMissing: boolean } | null | 'unreadable'> => {
  try {
    const raw = await run<unknown>('drafts', 'readonly', (s) => s.get('main'))
    if (raw === undefined) return null
    if (!isObj(raw)) return 'unreadable'
    const rawPhotos = await run<unknown>('drafts', 'readonly', (s) => s.get('photos'))
    const photos = blobs(rawPhotos)
    const cat = normalizeCat(raw.cat, { photos, clip: null })
    if (!cat) return 'unreadable'
    const { photos: _p, ...rest } = cat
    return {
      cat,
      photosMissing: rawPhotos === undefined,
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
