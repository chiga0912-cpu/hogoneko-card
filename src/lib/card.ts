// カードをスマホの中で描く（AIは使わない。SPEC 3章）
// 今は「猫カード」（SPEC 3.2 の3番目）。案A・案Bを見比べる（11/5。作る人が選んだら、使わない案を外す）
//   案A：写真を全面に。下のほうを暗くして、影を付けた白い大きな文字を写真の上に直接置く
//   案B：上下にテーマ色の帯。帯の中に大きな文字。写真は切らずに真ん中に置く
// 写真はこの中で描くだけ。外には送らない

export const CARD_W = 1080
export const CARD_H = 1920

export type CardSize = 'small' | 'normal' | 'large' // 文字の大きさ（試し用。決まったら外す）
export type TextPosition = 'up' | 'normal' | 'down'
export type CardDesign = 'A' | 'B' // 見比べ用。決まったら外す

// Instagramのリールで、ボタンや説明文が重なる所（端からの距離）⚙ 仮の数字
// 🧪 11/5に、ものさし画像を実機のInstagramの編集画面で見て決める（SPEC 3.1）
export const SAFE = { top: 220, bottom: 420, left: 64, right: 180 }

const INK = '#3a2e26'
const WHITE = '#ffffff'
const FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif'

// 文字の大きさ（1080×1920の中の大きさ）。横幅の6〜7割を使う、短い見出しくらい（DEVLOG 11/4夜）
const NAME_PX = 132
const LINE_PX = 64
const SIZE_K: Record<CardSize, number> = { small: 0.85, normal: 1, large: 1.15 }
const SCALES = [1, 0.92, 0.84, 0.76] // 長いときは、この順に小さくする（0.76 まで）
const NAME_SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5] // 名前は本文とは別に、2行に収まるまで（0.5倍まで）

const TEXT_W = CARD_W - SAFE.left - SAFE.right // 文字を置いてよい横幅

export type CardLayout = {
  design: CardDesign
  fits: boolean // 名前とカードの言葉が、決めた範囲に収まったか
  scale: number // 長いので小さくした割合（1 = そのまま）
  linesShown: number // 載せたカードの言葉の行数（元の行のまま。行の途中では切らない）
  linesTotal: number
  contrast: number // 文字と、その後ろの色の見やすさ（4.5以上なら読みやすい）。案Aは写真の明るい所で測る
  darken: number // 案A：写真の下のほうを暗くした強さ（0〜1）
}

type Img = CanvasImageSource & { width: number; height: number }

// 日本語を、幅に収まるように折り返す（「、」「。」などで行を始めない）
const NO_START = '、。，．,.）」』】〕！？!?ーぁぃぅぇぉっゃゅょァィゥェォッャュョ'
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of [...text]) {
    if (ctx.measureText(cur + ch).width <= width || cur === '') {
      cur += ch
    } else if (NO_START.includes(ch) && cur.length > 1) {
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

const lin = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
function hexLum(hex: string) {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return lum((n >> 16) & 255, (n >> 8) & 255, n & 255)
}
const round1 = (n: number) => Math.round(n * 10) / 10

// 名前とカードの言葉の大きさと折り返しを決める
type Planned = { nameLines: string[]; body: string[][]; nameSize: number; lineSize: number; h: number }
const NAME_LH = 1.18
const LINE_LH = 1.42
const GAP = 22

function planName(ctx: CanvasRenderingContext2D, name: string, k: number, width: number) {
  for (const s of NAME_SCALES) {
    const size = Math.round(NAME_PX * k * s)
    ctx.font = `800 ${size}px ${FONT}`
    const lines = wrap(ctx, name, width)
    if (lines.length <= 2 || s === NAME_SCALES[NAME_SCALES.length - 1]) return { size, lines }
  }
  return { size: Math.round(NAME_PX * k * 0.5), lines: [name] }
}

function plan(ctx: CanvasRenderingContext2D, name: string, lines: string[], k: number, n: number, width: number): Planned {
  const { size: nameSize, lines: nameLines } = planName(ctx, name, k, width)
  const lineSize = Math.round(LINE_PX * k)
  ctx.font = `700 ${lineSize}px ${FONT}`
  const body = lines.slice(0, n).map((l) => wrap(ctx, l, width))
  return { nameLines, body, nameSize, lineSize, h: blockH({ nameLines, body, nameSize, lineSize }) }
}
const rowsOf = (body: string[][]) => body.reduce((a, b) => a + b.length, 0)
function nameH(p: Pick<Planned, 'nameLines' | 'nameSize'>) {
  return p.nameLines.length * p.nameSize * NAME_LH
}
function bodyH(p: Pick<Planned, 'body' | 'lineSize'>) {
  return rowsOf(p.body) * p.lineSize * LINE_LH
}
function blockH(p: Omit<Planned, 'h'>) {
  const b = bodyH(p)
  return nameH(p) + (b ? GAP + b : 0)
}

// 長いときは、まず文字を小さくする。それでも入らなければ、後ろの行から載せない（行の途中では切らない。書き換えない）
function choose(
  ctx: CanvasRenderingContext2D,
  name: string,
  lines: string[],
  k: number,
  width: number,
  ok: (p: Planned) => boolean,
): { p: Planned; scale: number; fits: boolean } {
  for (let n = lines.length; n >= 0; n--) {
    for (const s of SCALES) {
      const p = plan(ctx, name, lines, k * s, n, width)
      if (p.nameLines.length <= 3 && ok(p)) return { p, scale: s, fits: true }
    }
  }
  const s = SCALES[SCALES.length - 1]
  return { p: plan(ctx, name, [], k * s, 0, width), scale: s, fits: false }
}

function drawCover(ctx: CanvasRenderingContext2D, img: Img, x: number, y: number, w: number, h: number) {
  // 真ん中を合わせて、枠いっぱいに（指で動かすのは、このあと）
  const s = Math.max(w / img.width, h / img.height)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s)
  ctx.restore()
}
function drawContain(ctx: CanvasRenderingContext2D, img: Img, x: number, y: number, w: number, h: number) {
  // 切らずに、枠の中に全体を入れる
  const s = Math.min(w / img.width, h / img.height)
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s)
}

function drawLogo(ctx: CanvasRenderingContext2D, logo: Img | null, x: number, y: number, size = 110) {
  if (!logo) return
  const s = size / Math.max(logo.width, logo.height)
  ctx.drawImage(logo, x, y, logo.width * s, logo.height * s)
}

// 文字を書く。align：left なら x から、center なら x を真ん中に
function drawText(
  ctx: CanvasRenderingContext2D,
  p: Planned,
  x: number,
  y: number,
  color: string,
  align: 'left' | 'center',
  shadow: boolean,
  parts: 'all' | 'name' | 'body' = 'all',
) {
  ctx.save()
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  ctx.textAlign = align
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 18
    ctx.shadowOffsetY = 3
  }
  let widest = 0
  if (parts !== 'body') {
    ctx.font = `800 ${p.nameSize}px ${FONT}`
    for (const l of p.nameLines) {
      ctx.fillText(l, x, y + p.nameSize * 0.06)
      widest = Math.max(widest, ctx.measureText(l).width)
      y += p.nameSize * NAME_LH
    }
    if (parts === 'all' && p.body.length) y += GAP
  }
  if (parts !== 'name') {
    ctx.font = `700 ${p.lineSize}px ${FONT}`
    for (const rows of p.body)
      for (const r of rows) {
        ctx.fillText(r, x, y + p.lineSize * 0.12)
        widest = Math.max(widest, ctx.measureText(r).width)
        y += p.lineSize * LINE_LH
      }
  }
  ctx.restore()
  return { widest, bottom: y }
}

// 写真の、文字を置く所の明るい側（明るいほうから1割の所）を測る。暗くする強さを決めるため
function brightLums(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const X = Math.max(0, Math.floor(x))
  const Y = Math.max(0, Math.floor(y))
  const W = Math.min(CARD_W - X, Math.ceil(w))
  const H = Math.min(CARD_H - Y, Math.ceil(h))
  if (W <= 0 || H <= 0) return [0, 0, 0]
  let d: Uint8ClampedArray
  try {
    d = ctx.getImageData(X, Y, W, H).data
  } catch {
    return [255, 255, 255] // 測れないときは、真っ白の写真として暗くする
  }
  const px: [number, number, number][] = []
  for (let i = 0; i < d.length; i += 4 * 7) px.push([d[i], d[i + 1], d[i + 2]])
  px.sort((a, b) => lum(...b) - lum(...a))
  return px[Math.floor(px.length * 0.1)] ?? [0, 0, 0]
}

type Opts = {
  photo: Img | null
  logo: Img | null
  name: string
  lines: string[] // カードの言葉（「いいところ」の行をそのまま）
  theme: string
  position: TextPosition
  size: CardSize
  design: CardDesign
}

export function drawCatCard(ctx: CanvasRenderingContext2D, opts: Opts): CardLayout {
  const lines = opts.lines.map((l) => l.trim()).filter(Boolean).slice(0, 3)
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  return opts.design === 'B' ? drawB(ctx, opts, lines) : drawA(ctx, opts, lines)
}

// 案A：写真を全面に。下のほうを暗くして、白い大きな文字
const A_MAX_H = 760 // 文字のかたまりの高さの上限（写真が主役。カードの4割まで）⚙
const A_LIFT: Record<TextPosition, number> = { down: 0, normal: 140, up: 300 } // 下の安全な所から、どれだけ上げるか ⚙

function drawA(ctx: CanvasRenderingContext2D, opts: Opts, lines: string[]): CardLayout {
  ctx.fillStyle = '#6b5f55'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (opts.photo) drawCover(ctx, opts.photo, 0, 0, CARD_W, CARD_H)

  const bottom = CARD_H - SAFE.bottom - A_LIFT[opts.position]
  const { p, scale, fits } = choose(ctx, opts.name, lines, SIZE_K[opts.size], TEXT_W, (p) => p.h <= A_MAX_H)
  const top = bottom - p.h

  // 暗くする強さ：文字の後ろの明るい所でも、白い文字が読める（見やすさ4.5以上）まで。最低0.35、最大0.85
  const [r, g, b] = brightLums(ctx, SAFE.left, top, TEXT_W, p.h)
  let darken = 0.35
  const after = (a: number) => lum(r * (1 - a), g * (1 - a), b * (1 - a))
  while (darken < 0.85 && ratio(1, after(darken)) < 4.5) darken = Math.min(0.85, darken + 0.05)

  // 文字の少し上から下の端まで、だんだん暗く
  const fadeFrom = Math.max(0, top - 260)
  const grad = ctx.createLinearGradient(0, fadeFrom, 0, top)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, `rgba(0,0,0,${darken})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, fadeFrom, CARD_W, top - fadeFrom)
  ctx.fillStyle = `rgba(0,0,0,${darken})`
  ctx.fillRect(0, top, CARD_W, CARD_H - top)

  drawLogo(ctx, opts.logo, SAFE.left, SAFE.top)
  const t = drawText(ctx, p, SAFE.left, top, WHITE, 'left', true)

  return {
    design: 'A',
    fits: fits && t.widest <= TEXT_W + 0.5 && top >= SAFE.top + 120 && t.bottom <= bottom + 1,
    scale,
    linesShown: p.body.length,
    linesTotal: lines.length,
    contrast: round1(ratio(1, after(darken))),
    darken: round1(darken * 100) / 100,
  }
}

// 案B：上下にテーマ色の帯。帯の中に大きな文字。写真は切らずに真ん中に
const B_PAD = 36 // 帯の中の、文字の上下の余白
const B_LOGO = 90 // 案Bのロゴは少し小さく（帯を低くするため）
const B_MIN_PHOTO = 700 // 写真に残す高さの下限 ⚙

function drawB(ctx: CanvasRenderingContext2D, opts: Opts, lines: string[]): CardLayout {
  // 帯の文字は、白と濃い色のうち、テーマ色の上で読みやすいほう（見直し A13 と同じ考え）
  const bandLum = hexLum(opts.theme)
  const white = ratio(1, bandLum)
  const ink = ratio(hexLum(INK), bandLum)
  const color = white >= ink ? WHITE : INK
  const logoH = opts.logo ? B_LOGO + 14 : 0

  const bands = (p: Planned) => {
    const topH = SAFE.top + logoH + nameH(p) + B_PAD
    const b = bodyH(p)
    const botH = b ? B_PAD + b + SAFE.bottom : 0
    return { topH, botH }
  }
  const { p, scale, fits } = choose(ctx, opts.name, lines, SIZE_K[opts.size], TEXT_W, (p) => {
    const { topH, botH } = bands(p)
    return CARD_H - topH - botH >= B_MIN_PHOTO
  })
  const { topH, botH } = bands(p)

  ctx.fillStyle = opts.theme
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (opts.photo) drawContain(ctx, opts.photo, 0, topH, CARD_W, CARD_H - topH - botH)

  drawLogo(ctx, opts.logo, SAFE.left, SAFE.top, B_LOGO)
  const cx = SAFE.left + TEXT_W / 2
  const n = drawText(ctx, p, cx, SAFE.top + logoH, color, 'center', false, 'name')
  let widest = n.widest
  let lastBottom = n.bottom
  if (p.body.length) {
    const t = drawText(ctx, p, cx, CARD_H - botH + B_PAD, color, 'center', false, 'body')
    widest = Math.max(widest, t.widest)
    lastBottom = t.bottom
  }

  return {
    design: 'B',
    fits: fits && widest <= TEXT_W + 0.5 && n.bottom <= topH && lastBottom <= CARD_H - SAFE.bottom + 1,
    scale,
    linesShown: p.body.length,
    linesTotal: lines.length,
    contrast: round1(Math.max(white, ink)),
    darken: 0,
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
