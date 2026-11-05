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
  type Clip,
  type Health,
  type Shelter,
} from './types'

const DB_NAME = 'hogoneko-card'
// 保存場所そのものの番号。2で catMedia を足した（中身の移し替えは、ここではしない。下の migrateCat）
// 3：入力の途中（drafts）の写真の記録の形を変えた（#44。{key, at, photos}）。置き場所は増やしていない。
//    番号を上げるのは、古い版の開いたままのタブに新しい形を読ませないため（古い版は写真0枚と読み、
//    そのまま保存すると名簿の写真が消える）。古い版のタブは道をあけて閉じ、そのあとは開けなくなる（11/6 作者の決定A）
const DB_VERSION = 3

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
  if (cat.clip) rosterClips.add(cat.clip.blob) // 名簿から読んだままの動画（途中を開き直すときに、名簿の動画を使ってよい）
  cat.photos.forEach((p, i) => rosterIndex.set(p, i)) // 名簿から読んだままの写真と、その並び（#44）
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
  photosKey?: string // 写真の組の番号（写真の中身と同じ組かを見分けるため。#44）
  photosRosterIdx?: number[] | null // 写真が全部、名簿から読んだ写真のときの、名簿の何枚目か（並び順のまま）
}
// 入力の途中を読む。読めないときは 'unreadable'（途中は消さない。新しく始めたときに上書きされる）
// photosMissing：途中の写真がまだ書かれていなかった（文字は書けたが、写真を書く前にページが終わったときなど）
// photosStatus：途中の写真の読め方（issue #44。動画の clipStatus と同じ考え）
//   'ok'      途中の記録と同じ写真の組として読めた
//   'old'     写真に番号を付ける前の版で書かれた途中（今までどおり、そのまま使う）
//   'missing' 途中の写真がまだ書かれていなかった（名簿の子なら、名簿の写真を使う）
//   'roster'  途中の写真は前の組のままだったが、新しい組は名簿の写真のままだった（名簿の写真を使う）
//   'stale'   選び直した写真を書き終える前にページが終わった（前の組のまま開き、知らせる）
// clipStatus：途中の動画の読め方（11/5 見直しの重い1・2）
//   'ok'     途中の動画が、途中の記録と同じ動画として読めた
//   'none'   動画は入っていなかった（外したなら外したまま開く）
//   'old'    動画を残す前の版で書かれた途中。名簿の子なら、名簿の動画を使う
//   'roster' 途中の動画は書けていなかったが、それは名簿の動画のままだった。名簿の動画を使う
//   'lost'   選び直した動画を書き終える前にページが終わった。名簿の動画には戻さず、知らせる
export type ClipStatus = 'ok' | 'none' | 'old' | 'roster' | 'lost'
export type PhotosStatus = 'ok' | 'old' | 'missing' | 'roster' | 'stale'
export const loadDraft = async (): Promise<
  { cat: Cat; draft: Draft; photosMissing: boolean; photosStatus: PhotosStatus; photosRosterIdx: number[] | null; clipStatus: ClipStatus; clipRange: { start: number; length: number } | null } | null | 'unreadable'
> => {
  try {
    const raw = await run<unknown>('drafts', 'readonly', (s) => s.get('main'))
    if (raw === undefined) return null
    if (!isObj(raw)) return 'unreadable'
    const rawPhotos = await run<unknown>('drafts', 'readonly', (s) => s.get('photos'))
    // 写真は {key, photos} の形（#44 から）。前の版は写真の並びだけ
    const keyed = isObj(rawPhotos) && Array.isArray(rawPhotos.photos)
    const photos = blobs(keyed ? (rawPhotos as Record<string, unknown>).photos : rawPhotos)
    // どちらの記録が新しいかを、書いた時刻で見分ける（写真は変えた直後に、文字は少しあとに書くため。見直し③の重い1）
    const savedAt = num(raw.savedAt, 0)
    const rp = keyed ? (rawPhotos as Record<string, unknown>) : null
    const photosAt = rp ? num(rp.at, 0) : 0
    const rosterIdx = Array.isArray(raw.photosRosterIdx) && raw.photosRosterIdx.every((i) => Number.isInteger(i) && i >= 0) ? (raw.photosRosterIdx as number[]) : null
    const wantKey = typeof raw.photosKey === 'string' ? raw.photosKey : null
    const photosStatus: PhotosStatus =
      rawPhotos === undefined
        ? wantKey === null || wantKey === '' || raw.fromRoster === true
          ? 'missing'
          : rosterIdx
            ? 'roster'
            : 'stale' // 新しい子で、最初の写真を書き終える前にページが終わった（見直し③の中6）
        : !keyed || wantKey === null
          ? 'old'
          : rp!.key === wantKey || photosAt >= savedAt // 写真の記録のほうが新しければ、それを使う
            ? 'ok'
            : rosterIdx
              ? 'roster'
              : 'stale'
    // 読み戻した写真に、保存してあった番号を付け直す（開き直すたびに新しい番号になり、何も変えていないのに
    // 書き直しや知らせが出るのを防ぐ。見直し③の重い3・中4）
    if (rp && typeof rp.key === 'string') {
      const ids = rp.key ? rp.key.split(',') : []
      if (ids.length === photos.length) photos.forEach((b, i) => clipIds.set(b, ids[i]))
      if (photosStatus === 'ok' && rp.key === wantKey) {
        lastPhotosKey = rp.key
        if (rosterIdx && rosterIdx.length === photos.length) photos.forEach((b, i) => rosterIndex.set(b, rosterIdx[i]))
      }
    }
    // 動画は、使う所（start・length）と動画の番号を途中の記録に、中身と番号を 'clip' に分けて残す。
    // 番号が合うときだけ使う（別の動画の中身に、今の始まりと長さを付けないため）
    const meta = isObj(raw.cat) ? raw.cat.clip : null
    const rawClip = isObj(meta) ? await run<unknown>('drafts', 'readonly', (s) => s.get('clip')) : undefined
    // 動画の記録が文字の記録より新しいとき（動画を選び直した直後に閉じた）は、動画の記録を使う。始まり・長さも動画の記録から
    const rc = isObj(rawClip) ? rawClip : null
    const clipNewer = !!rc && typeof rc.id === 'string' && num(rc.at, 0) >= savedAt && savedAt > 0
    const sameClip = isObj(meta) && !!rc && typeof meta.clipId === 'string' && rc.id === meta.clipId
    const clipBlob = sameClip || clipNewer ? blobOrNull(rc!.blob) : null
    const clip = clipBlob
      ? sameClip
        ? { blob: clipBlob, start: (meta as Record<string, unknown>).start, length: (meta as Record<string, unknown>).length }
        : { blob: clipBlob, start: num(rc!.start, 0), length: num(rc!.length, 5) }
      : null
    if (clipBlob && rc && typeof rc.id === 'string') {
      clipIds.set(clipBlob, rc.id) // 番号を付け直す（開き直すたびに大きな動画を書き直さないため）
      lastClipId = rc.id
      if (sameClip && isObj(meta) && meta.roster === true) rosterClips.add(clipBlob)
    }
    const clipStatus: ClipStatus =
      raw.clipSaved !== true ? 'old' : clip ? 'ok' : !isObj(meta) ? 'none' : meta.roster === true ? 'roster' : 'lost'
    const cat = normalizeCat(raw.cat, { photos, clip })
    if (!cat) return 'unreadable'
    const { photos: _p, ...rest } = cat
    return {
      cat,
      photosMissing: rawPhotos === undefined,
      photosStatus,
      photosRosterIdx: rosterIdx,
      clipStatus,
      clipRange: isObj(meta) ? { start: num(meta.start, 0), length: num(meta.length, 5) } : null,
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

// 動画ごとの番号（この画面を開いている間だけ覚える）と、名簿から読んだままの動画か
const clipIds = new WeakMap<Blob, string>()
const rosterClips = new WeakSet<Blob>()
// 写真の組の番号（写真1枚ずつの番号をつなげたもの）と、全部が名簿から読んだままの写真か（#44）
// 名簿から読んだ写真が、名簿の何枚目か（外したり並べ替えたりしても、名簿の写真から同じ組と並びを作り直せるように。見直し③の重い2）
const rosterIndex = new WeakMap<Blob, number>()
export const photosKeyOf = (photos: Blob[]) => photos.map(clipIdOf).join(',')
export const photosRosterIdxOf = (photos: Blob[]): number[] | null =>
  photos.length > 0 && photos.every((p) => rosterIndex.has(p)) ? photos.map((p) => rosterIndex.get(p)!) : null
let lastPhotosKey: string | null = null // 保存場所にある写真の組の番号（同じ組を書き直さないため）
let lastClipId: string | null = null
const clipIdOf = (b: Blob) => {
  let id = clipIds.get(b)
  if (!id) clipIds.set(b, (id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`))
  return id
}

// 途中の記録には、動画の中身は入れない（大きいので、変わったときだけ saveDraftClip で書く）
export const saveDraft = (draft: Draft) =>
  run<void>('drafts', 'readwrite', (s) =>
    s.put(
      {
        ...draft,
        cat: {
          ...draft.cat,
          clip: draft.cat.clip && {
            start: draft.cat.clip.start,
            length: draft.cat.clip.length,
            clipId: clipIdOf(draft.cat.clip.blob),
            roster: rosterClips.has(draft.cat.clip.blob),
          },
        },
        clipSaved: true, // 動画を残す版で書いた印（前の版の途中と見分けるため）
        savedAt: Date.now(), // 写真・動画の記録とどちらが新しいかを見分けるため
        schemaVersion: SCHEMA_VERSION,
      },
      'main',
    ),
  )
// 書き込みは、あとから呼ばれたものだけを残す（大きい動画の書き込みが、あとの小さい動画より遅く終わっても上書きしない）
let clipSeq = 0
export async function saveDraftClip(clip: Clip | null) {
  const seq = ++clipSeq
  const at = Date.now()
  const id = clip ? clipIdOf(clip.blob) : null
  if (id !== null && id === lastClipId) return // 同じ動画がもう保存場所にある（開き直しただけ）
  const stored = clip && id ? { id, blob: await pack(clip.blob), start: clip.start, length: clip.length, at } : null
  if (seq !== clipSeq) return
  await run<void>('drafts', 'readwrite', (s) => (stored ? s.put(stored, 'clip') : s.delete('clip')))
  lastClipId = id
}
// 書き込みは、あとから呼ばれたものだけを残す（大きい写真の書き込みが、あとの書き込みより遅く終わっても上書きしない。#44）
let photosSeq = 0
export async function saveDraftPhotos(photos: Blob[]) {
  const seq = ++photosSeq
  const at = Date.now()
  const key = photosKeyOf(photos)
  if (key === lastPhotosKey) return // 同じ組がもう保存場所にある（開き直しただけ）
  const stored = { key, at, photos: await Promise.all(photos.map(pack)) }
  if (seq !== photosSeq) return
  await run<void>('drafts', 'readwrite', (s) => s.put(stored, 'photos'))
  lastPhotosKey = key
}
export const clearDraft = () => {
  clipSeq++ // 消したあとに、前の動画・写真の書き込みが入らないように
  photosSeq++
  lastPhotosKey = null
  lastClipId = null
  return run<void>('drafts', 'readwrite', (s) => s.clear())
}

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
