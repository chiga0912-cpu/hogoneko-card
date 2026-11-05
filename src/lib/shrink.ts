// 写真を選んだときに小さくする（issue #2。見直し A5）。スマホの中だけで行い、外には送らない
// - 長い辺を PHOTO_MAX まで小さくし、JPEGにする（作る人の決定。11/5：2560px）
//   カードは 1080×1920。縦の写真（案A）を全面に広げるには長い辺 1920 が最低限。2560 は、指での拡大（#29）や
//   写真のゆっくりした動きのための余裕（3:4の縦の写真なら 1.33倍まで拡大してもぼやけない）
// - 小さい写真は大きくしない。小さくしてかえってファイルが大きくなるとき・読めないときは、元の写真をそのまま残す
// - 1枚ずつ処理する（何枚も同時に広げると、iPhoneで重さのために止まるおそれがあるため）
import { copyBlob } from '../db'
import { loadImage } from './card'

export const PHOTO_MAX = 2560
const QUALITY = 0.85
// 名簿の一覧の小さな表紙（issue #3）。一覧では56pxで出すので、画面のきめ細かさ（3倍）でも足りる大きさ。
// 一覧にだけ使う。カード・動画には使わない（元の写真を使う）
export const COVER_MAX = 240

// ?sizes=1 で開いたときだけ画面に出す数字（写真の名前は持たない）
export type ShrinkInfo = {
  fromW: number
  fromH: number
  fromBytes: number
  toW: number
  toH: number
  toBytes: number
  ms: number
  result: 'shrunk' | 'kept-small' | 'kept-unreadable'
}

const toJpeg = (canvas: HTMLCanvasElement, quality = QUALITY): Promise<Blob | null> =>
  new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    } catch {
      resolve(null) // 描けない画像（安全のため書き出しが止められたときなど）
    }
  })

export async function shrinkPhoto(file: Blob): Promise<{ blob: Blob; info: ShrinkInfo }> {
  // 先に中身を写しておく（iPhoneでは、選んだファイルがあとで読めなくなることがあるため）
  return resize(await copyBlob(file), PHOTO_MAX, QUALITY)
}

// 名簿の一覧の表紙を作る。作れなかったときは、元の写真をそのまま表紙にする（一覧で写真が消えたように見せない）
export async function makeCover(photo: Blob | null | undefined): Promise<Blob | null> {
  if (!photo) return null
  try {
    return (await resize(photo, COVER_MAX, 0.8)).blob
  } catch {
    return photo
  }
}

async function resize(copy: Blob, max: number, quality: number): Promise<{ blob: Blob; info: ShrinkInfo }> {
  const t0 = performance.now()
  const info = (blob: Blob, w: number, h: number, toW: number, toH: number, result: ShrinkInfo['result']) => ({
    blob,
    info: { fromW: w, fromH: h, fromBytes: copy.size, toW, toH, toBytes: blob.size, ms: performance.now() - t0, result },
  })

  let img: HTMLImageElement
  try {
    img = await loadImage(copy) // 撮ったときの向き（回転の印）はブラウザが直して読む
  } catch {
    return info(copy, 0, 0, 0, 0, 'kept-unreadable')
  }
  // 描く前に、写真をほどいておく（描くときにほどくと、その間画面が固まるため。移し替えの間も固めない。issue #3）
  try {
    await img.decode()
  } catch {
    // ほどけなくても、描いてみる（下で失敗したら元の写真のまま）
  }
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) return info(copy, w, h, w, h, 'kept-unreadable')

  const s = Math.min(1, max / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * s))
  const th = Math.max(1, Math.round(h * s))
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  let out: Blob | null = null
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff' // 透明な所（スクリーンショットなど）は白に
    ctx.fillRect(0, 0, tw, th)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, tw, th)
    out = await toJpeg(canvas, quality)
  }
  // iPhoneのSafariは、使い終わった画像の場所をすぐに返さないことがあるので、空にしておく
  canvas.width = 0
  canvas.height = 0
  img.src = ''

  if (!out) return info(copy, w, h, w, h, 'kept-unreadable')
  // 大きくしていない（元が小さい）うえに、かえってファイルが大きくなるなら、元のまま
  if (s === 1 && out.size >= copy.size) return info(copy, w, h, w, h, 'kept-small')
  return info(out, w, h, tw, th, 'shrunk')
}
