// カードをスマホの中で描く（AIは使わない。SPEC 3章）
// 今は「猫カード」（SPEC 3.2 の3番目）：写真を全面に、名前とカードの言葉を便箋風の枠で、真ん中より下に小さめに
// 写真はこの中で描くだけ。外には送らない

export const CARD_W = 1080
export const CARD_H = 1920

export type CardSize = 'small' | 'normal' | 'large' // 文字の大きさ（試し用。決まったら外す）
export type TextPosition = 'up' | 'normal' | 'down'

// 文字は、いつも紙の色の上に濃い色で書く。テーマ色は枠の線と飾りだけ（明るいテーマ色でも読めるように）
const PAPER = { r: 255, g: 251, b: 244, a: 0.93 }
const INK = '#3a2e26'
const FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif'

// 枠を置いてよい帯：真ん中（960）から、下の 1536 まで ⚙（仮）
// 右と下はInstagramの表示が重なるので空ける。正確な幅は 🧪 11/5に実機で確かめる（SPEC 3.1）
const BAND_TOP = CARD_H / 2
const BAND_BOTTOM = 1536
const FRAME_X = 64
const FRAME_W = CARD_W - FRAME_X - 160 // 右を広めに空ける（いいね・コメントのボタンの側）
const PAD = 44
const INNER_W = FRAME_W - PAD * 2
const MAX_FRAME_H = 520 // 写真が主役なので、枠は小さめ ⚙（仮）

const SIZE_K: Record<CardSize, number> = { small: 0.85, normal: 1, large: 1.2 }
const SCALES = [1, 0.92, 0.84, 0.76] // 長いときは、この順に小さくする（0.76 まで）

export type CardLayout = {
  fits: boolean // 名前とカードの言葉が、枠にも、カードにも収まったか
  scale: number // 長いので小さくした割合（1 = そのまま）
  linesShown: number // 載せたカードの言葉の行数（元の行のまま。行の途中では切らない）
  linesTotal: number
  contrast: number // 文字と枠の色の見やすさ（4.5以上なら読みやすい。枠の下が真っ黒でも、の値）
}

// 日本語を、幅に収まるように折り返す（「、」「。」などで行を始めない）
const NO_START = '、。，．,.）」』】〕！？!?ーぁぃぅぇぉっゃゅょァィゥェォッャュョ'
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of [...text]) {
    if (ctx.measureText(cur + ch).width <= width || cur === '') {
      cur += ch
    } else if (NO_START.includes(ch) && cur.length > 1) {
      // 行頭に来る記号は、前の行の最後の1文字と一緒に次の行へ
      lines.push(cur.slice(0, -1))
      cur = cur.slice(-1) + ch
    } else {
      lines.push(cur)
      cur = ch
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function luminance(r: number, g: number, b: number) {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrastOf(hexInk: string) {
  const n = parseInt(hexInk.slice(1), 16)
  const ink = luminance((n >> 16) & 255, (n >> 8) & 255, n & 255)
  // 枠の下が真っ黒の写真でも、の紙の色
  const paper = luminance(PAPER.r * PAPER.a, PAPER.g * PAPER.a, PAPER.b * PAPER.a)
  return (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05)
}

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }) {
  // 真ん中を合わせて、画面いっぱいに（指で動かすのは11/5）
  const s = Math.max(CARD_W / img.width, CARD_H / img.height)
  const w = img.width * s
  const h = img.height * s
  ctx.drawImage(img, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h)
}

type Planned = { nameLines: string[]; body: string[][]; nameSize: number; lineSize: number; h: number }

// 名前は、本文とは別に小さくする。2行に収まるまで（0.5倍まで）。それでも入らなければ3行まで使う（名前は切らない）
const NAME_SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5]
function planName(ctx: CanvasRenderingContext2D, name: string, k: number) {
  for (const s of NAME_SCALES) {
    const size = Math.round(64 * k * s)
    ctx.font = `700 ${size}px ${FONT}`
    const lines = wrap(ctx, name, INNER_W)
    if (lines.length <= 2 || s === NAME_SCALES[NAME_SCALES.length - 1]) return { size, lines }
  }
  return { size: Math.round(64 * k * 0.5), lines: [name] }
}

function plan(ctx: CanvasRenderingContext2D, name: string, lines: string[], k: number, n: number): Planned {
  const { size: nameSize, lines: nameLines } = planName(ctx, name, k)
  const lineSize = Math.round(42 * k)
  ctx.font = `500 ${lineSize}px ${FONT}`
  const body = lines.slice(0, n).map((l) => wrap(ctx, l, INNER_W))
  const bodyRows = body.reduce((a, b) => a + b.length, 0)
  const h = PAD * 2 + nameLines.length * nameSize * 1.3 + (bodyRows ? 18 + bodyRows * lineSize * 1.6 : 0)
  return { nameLines, body, nameSize, lineSize, h }
}

export function drawCatCard(
  ctx: CanvasRenderingContext2D,
  opts: {
    photo: (CanvasImageSource & { width: number; height: number }) | null
    logo: (CanvasImageSource & { width: number; height: number }) | null
    name: string
    lines: string[] // カードの言葉（「いいところ」の行をそのまま）
    theme: string
    position: TextPosition
    size: CardSize
  },
): CardLayout {
  const lines = opts.lines.map((l) => l.trim()).filter(Boolean).slice(0, 3)
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  ctx.fillStyle = '#d9cfc3'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (opts.photo) drawCover(ctx, opts.photo)

  // 長いときは、まず文字を小さくする。それでも入らなければ、後ろの行から載せない（行の途中では切らない。書き換えない）
  let chosen: Planned | null = null
  let scale = 1
  for (let n = lines.length; n >= 0 && !chosen; n--) {
    for (const s of SCALES) {
      const p = plan(ctx, opts.name, lines, SIZE_K[opts.size] * s, n)
      if (p.h <= MAX_FRAME_H && p.nameLines.length <= 3) {
        chosen = p
        scale = s
        break
      }
    }
  }
  const fitsInFrame = chosen !== null
  if (!chosen) {
    scale = SCALES[SCALES.length - 1]
    chosen = plan(ctx, opts.name, [], SIZE_K[opts.size] * scale, 0)
  }
  const p = chosen

  // 枠の位置：少し上＝帯の上、ふつう＝帯の真ん中、少し下＝帯の下
  const h = Math.min(p.h, BAND_BOTTOM - BAND_TOP)
  const top =
    opts.position === 'up'
      ? BAND_TOP + 24
      : opts.position === 'down'
        ? BAND_BOTTOM - h
        : BAND_TOP + (BAND_BOTTOM - BAND_TOP - h) / 2

  // 便箋風の枠
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.18)'
  ctx.shadowBlur = 24
  ctx.fillStyle = `rgba(${PAPER.r},${PAPER.g},${PAPER.b},${PAPER.a})`
  ctx.beginPath()
  ctx.roundRect(FRAME_X, top, FRAME_W, h, 28)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = opts.theme
  ctx.globalAlpha = 0.7
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect(FRAME_X + 12, top + 12, FRAME_W - 24, h - 24, 20)
  ctx.stroke()
  ctx.globalAlpha = 1

  // 名前
  let y = top + PAD
  ctx.fillStyle = INK
  ctx.textBaseline = 'top'
  ctx.font = `700 ${p.nameSize}px ${FONT}`
  let widest = 0
  for (const l of p.nameLines) {
    ctx.fillText(l, FRAME_X + PAD, y)
    widest = Math.max(widest, ctx.measureText(l).width)
    y += p.nameSize * 1.3
  }

  // カードの言葉（便箋の罫線つき）
  if (p.body.length) y += 18
  ctx.font = `500 ${p.lineSize}px ${FONT}`
  for (const rows of p.body) {
    for (const r of rows) {
      ctx.fillStyle = INK
      ctx.fillText(r, FRAME_X + PAD, y + p.lineSize * 0.2)
      widest = Math.max(widest, ctx.measureText(r).width)
      ctx.strokeStyle = opts.theme
      ctx.globalAlpha = 0.35
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(FRAME_X + PAD, y + p.lineSize * 1.45)
      ctx.lineTo(FRAME_X + FRAME_W - PAD, y + p.lineSize * 1.45)
      ctx.stroke()
      ctx.globalAlpha = 1
      y += p.lineSize * 1.6
    }
  }

  // ロゴは左上に小さく
  if (opts.logo) {
    const s = 120 / Math.max(opts.logo.width, opts.logo.height)
    ctx.drawImage(opts.logo, 48, 48, opts.logo.width * s, opts.logo.height * s)
  }

  return {
    fits: fitsInFrame && widest <= INNER_W + 0.5 && top >= 0 && top + h <= CARD_H && y <= top + h + 1,
    scale,
    linesShown: p.body.length,
    linesTotal: lines.length,
    contrast: Math.round(contrastOf(INK) * 10) / 10,
  }
}

// 写真やロゴのBlobを、描ける形にする（スマホの中だけ）
export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('画像を読めませんでした'))
    }
    img.src = url
  })
}
