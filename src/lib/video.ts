// カードと撮った動画を、スマホの中で1本の動画にする（AIは使わない。SPEC 3.4）
// 作り方は上から順に試す：①1コマずつ（WebCodecs＋mediabunny）②録画（MediaRecorder）③カードを画像で保存
// どれを使うかは機種の名前で決めず、そのスマホに「作れるか」を聞いて決める ⚙
// 写真・動画はこの中で描くだけ。外には送らない
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeVideo,
} from 'mediabunny'
import { CARD_H, CARD_W } from './card'

export const FPS = 30 // 撮った動画も30コマ/秒にそろえる（テストDと同じ）
export type Method = 'frames' | 'record' | 'image'

// 1枚の絵（カード）を sec 秒見せる／撮った動画の start 秒から length 秒を使う
export type Segment =
  | { kind: 'card'; label: string; sec: number; image: HTMLCanvasElement }
  | { kind: 'clip'; label: string; blob: Blob; start: number; length: number; overlay: (ctx: CanvasRenderingContext2D) => void }

export type Progress = (ratio: number) => void

// ①：1コマずつ作る仕組みがあり、H.264で1080×1920を作れるとき
// ②：①が使えず、録画の仕組みがあり、mp4で作れるとき
// ③：どちらも使えないとき
export async function pickMethod(): Promise<Method> {
  try {
    if (typeof VideoEncoder !== 'undefined' && (await canEncodeVideo('avc', { width: CARD_W, height: CARD_H }))) return 'frames'
  } catch {
    // 聞けなかったら次へ
  }
  if (recordMime()) return 'record'
  return 'image'
}

function recordMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return ''
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4']) if (MediaRecorder.isTypeSupported(m)) return m
  return ''
}

export const totalSec = (segs: Segment[]) => segs.reduce((s, g) => s + (g.kind === 'card' ? g.sec : g.length), 0)

const newCanvas = () => {
  const cv = document.createElement('canvas')
  cv.width = CARD_W
  cv.height = CARD_H
  return cv
}

// 縦の動画は画面いっぱい、横の動画は上下に帯を付けて全体を見せる（テストDと同じ）
const isTall = (w: number, h: number) => h >= w

// ① 1コマずつ
async function makeByFrames(segs: Segment[], onProgress: Progress): Promise<Blob> {
  const cv = newCanvas()
  const ctx = cv.getContext('2d')!
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const src = new CanvasSource(cv, { codec: 'avc', quality: QUALITY_HIGH })
  output.addVideoTrack(src, { frameRate: FPS })
  await output.start()
  const total = Math.max(1, totalSec(segs) * FPS)
  let frame = 0
  const add = async () => {
    await src.add(frame / FPS, 1 / FPS)
    frame++
    if (frame % FPS === 0) onProgress(frame / total)
  }
  for (const g of segs) {
    if (g.kind === 'card') {
      for (let f = 0; f < Math.round(g.sec * FPS); f++) {
        ctx.drawImage(g.image, 0, 0)
        await add()
      }
      continue
    }
    const input = new Input({ source: new BlobSource(g.blob), formats: ALL_FORMATS })
    try {
      const track = await input.getPrimaryVideoTrack()
      if (!track) throw new Error('撮った動画が読めません')
      if (!(await track.canDecode())) throw new Error(`撮った動画の形式（${track.codec}）を読めません`)
      const first = await track.getFirstTimestamp()
      const tall = isTall(track.displayWidth, track.displayHeight)
      const sink = new CanvasSink(track, { width: CARD_W, height: CARD_H, fit: tall ? 'cover' : 'contain', poolSize: 2 })
      const times = Array.from({ length: Math.round(g.length * FPS) }, (_, f) => first + g.start + f / FPS)
      let last: HTMLCanvasElement | OffscreenCanvas | null = null
      for await (const fr of sink.canvasesAtTimestamps(times)) {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, CARD_W, CARD_H)
        const c = fr?.canvas ?? last
        if (c) ctx.drawImage(c, 0, 0)
        if (fr) last = fr.canvas
        g.overlay(ctx)
        await add()
      }
    } finally {
      input.dispose()
    }
  }
  await output.finalize()
  onProgress(1)
  return new Blob([output.target.buffer!], { type: 'video/mp4' })
}

// ② 録画（実際の時間がかかる。13秒の動画なら13秒）
async function makeByRecording(segs: Segment[], onProgress: Progress): Promise<Blob> {
  const mime = recordMime()
  const cv = newCanvas()
  const ctx = cv.getContext('2d')!
  ctx.drawImage((segs.find((g) => g.kind === 'card') as { image: HTMLCanvasElement } | undefined)?.image ?? cv, 0, 0)
  const stream = cv.captureStream(FPS)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const done = new Promise<Blob>((ok, ng) => {
    rec.onstop = () => ok(new Blob(chunks, { type: rec.mimeType || mime }))
    rec.onerror = () => ng(new Error('録画できませんでした'))
  })
  const total = totalSec(segs)
  let passed = 0
  rec.start(1000)
  try {
    for (const g of segs) {
      if (g.kind === 'card') {
        await playFor(g.sec, () => ctx.drawImage(g.image, 0, 0))
      } else {
        const video = await openVideo(g.blob, g.start)
        try {
          await video.play()
          await playFor(g.length, () => {
            drawVideo(ctx, video)
            g.overlay(ctx)
          })
        } finally {
          video.pause()
          URL.revokeObjectURL(video.src)
        }
      }
      passed += g.kind === 'card' ? g.sec : g.length
      onProgress(passed / total)
    }
  } finally {
    rec.stop()
  }
  const blob = await done
  stream.getTracks().forEach((t) => t.stop())
  return blob
}

const playFor = (sec: number, draw: () => void) =>
  new Promise<void>((ok) => {
    const t0 = performance.now()
    const tick = () => {
      draw()
      if (performance.now() - t0 >= sec * 1000) ok()
      else requestAnimationFrame(tick)
    }
    tick()
  })

function drawVideo(ctx: CanvasRenderingContext2D, v: HTMLVideoElement) {
  const w = v.videoWidth || CARD_W
  const h = v.videoHeight || CARD_H
  const s = isTall(w, h) ? Math.max(CARD_W / w, CARD_H / h) : Math.min(CARD_W / w, CARD_H / h)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  ctx.drawImage(v, (CARD_W - w * s) / 2, (CARD_H - h * s) / 2, w * s, h * s)
}

function openVideo(blob: Blob, start: number): Promise<HTMLVideoElement> {
  return new Promise((ok, ng) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.onloadedmetadata = () => {
      v.onseeked = () => ok(v)
      v.currentTime = start
    }
    v.onerror = () => ng(new Error('撮った動画が読めません'))
    v.src = URL.createObjectURL(blob)
  })
}

// 撮った動画の、ある時点の1コマ（写真がなく動画だけのとき、表紙と猫カードに使う。SPEC 3.2）
export async function clipFrame(blob: Blob, at: number): Promise<HTMLCanvasElement | null> {
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
    try {
      const track = await input.getPrimaryVideoTrack()
      if (track && (await track.canDecode())) {
        const first = await track.getFirstTimestamp()
        // 元の向き・大きさのまま取り出す（カードの側で、縦・横に合わせて描くため）
        const sink = new CanvasSink(track, { poolSize: 1 })
        const fr = await sink.getCanvas(first + at)
        if (fr) {
          const out = document.createElement('canvas')
          out.width = fr.canvas.width
          out.height = fr.canvas.height
          out.getContext('2d')!.drawImage(fr.canvas, 0, 0)
          return out
        }
      }
    } finally {
      input.dispose()
    }
  } catch {
    // 下の方法で試す
  }
  try {
    const v = await openVideo(blob, at)
    const out = document.createElement('canvas')
    out.width = v.videoWidth
    out.height = v.videoHeight
    out.getContext('2d')!.drawImage(v, 0, 0)
    URL.revokeObjectURL(v.src)
    return out
  } catch {
    return null
  }
}

export type Made =
  | { kind: 'video'; blob: Blob; method: 'frames' | 'record'; ms: number; sec: number }
  | { kind: 'image'; images: Blob[]; failed: boolean; ms: number } // failed：動画を作る途中で失敗したので画像にした

const toJpeg = (cv: HTMLCanvasElement) =>
  new Promise<Blob>((ok, ng) => cv.toBlob((b) => (b ? ok(b) : ng(new Error('画像を作れませんでした'))), 'image/jpeg', 0.92))

// 動画を作る。作っている途中で失敗したら、画像で保存する（SPEC 3.4 の③）
export async function makeReel(segs: Segment[], onProgress: Progress, method?: Method): Promise<Made> {
  const t0 = performance.now()
  const m = method ?? (await pickMethod())
  if (m !== 'image') {
    try {
      const blob = m === 'frames' ? await makeByFrames(segs, onProgress) : await makeByRecording(segs, onProgress)
      return { kind: 'video', blob, method: m, ms: performance.now() - t0, sec: totalSec(segs) }
    } catch (e) {
      console.warn('動画を作れませんでした', e)
      const images = await cardImages(segs)
      return { kind: 'image', images, failed: true, ms: performance.now() - t0 }
    }
  }
  return { kind: 'image', images: await cardImages(segs), failed: false, ms: performance.now() - t0 }
}

const cardImages = (segs: Segment[]) =>
  Promise.all(segs.filter((g): g is Extract<Segment, { kind: 'card' }> => g.kind === 'card').map((g) => toJpeg(g.image)))

// ── 位置情報が残っていないかの確認（テストEと同じ見つけ方。11/4 iPhoneの本物の動画でも働いた）──
// 場所そのもの（数字）は出さず、「あり／なし」だけを返す
const LOCATION_MARKS = [
  new Uint8Array([0xa9, 0x78, 0x79, 0x7a]), // ©xyz
  new TextEncoder().encode('loci'),
  new TextEncoder().encode('ISO6709'),
  new TextEncoder().encode('com.apple.quicktime.location'),
]
function hasMark(bytes: Uint8Array, mark: Uint8Array) {
  outer: for (let i = 0; i <= bytes.length - mark.length; i++) {
    for (let j = 0; j < mark.length; j++) if (bytes[i + j] !== mark[j]) continue outer
    return true
  }
  return false
}
// 動画ファイルは「箱」が並んだ形。映像そのもの（mdat）以外の箱をすべて調べる
export async function videoHasLocation(blob: Blob): Promise<'あり' | 'なし' | '調べられない'> {
  try {
    let pos = 0
    while (pos + 8 <= blob.size) {
      const head = new DataView(await blob.slice(pos, pos + 16).arrayBuffer())
      let size = head.getUint32(0)
      const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7))
      if (size === 1) size = Number(head.getBigUint64(8))
      else if (size === 0) size = blob.size - pos
      if (size < 8) return '調べられない'
      if (type !== 'mdat') {
        const bytes = new Uint8Array(await blob.slice(pos, pos + size).arrayBuffer())
        if (LOCATION_MARKS.some((m) => hasMark(bytes, m))) return 'あり'
      }
      pos += size
    }
    return 'なし'
  } catch {
    return '調べられない'
  }
}

// 画像（JPEG）に位置情報がないか。カードの画像はスマホの中で描いたものなので、ふつうは入っていない。
// 撮影情報（Exif）の中に、位置の印（GPSの番号 0x8825）があれば「あり」とみなす
export async function imageHasLocation(blob: Blob): Promise<'あり' | 'なし' | '調べられない'> {
  try {
    const b = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer())
    if (b[0] !== 0xff || b[1] !== 0xd8) return blob.type === 'image/jpeg' ? '調べられない' : 'なし'
    let i = 2
    while (i + 4 <= b.length && b[i] === 0xff) {
      const marker = b[i + 1]
      const len = (b[i + 2] << 8) | b[i + 3]
      if (marker === 0xda) break // ここから先は絵そのもの
      if (marker === 0xe1) {
        const seg = b.subarray(i + 4, i + 2 + len)
        const isExif = seg[0] === 0x45 && seg[1] === 0x78 && seg[2] === 0x69 && seg[3] === 0x66
        if (isExif && (hasMark(seg, new Uint8Array([0x88, 0x25])) || hasMark(seg, new Uint8Array([0x25, 0x88])))) return 'あり'
      }
      i += 2 + len
    }
    return 'なし'
  } catch {
    return '調べられない'
  }
}
