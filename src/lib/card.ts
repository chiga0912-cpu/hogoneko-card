// カードをスマホの中で描く（AIは使わない。SPEC 3章）
// 今は「猫カード」（SPEC 3.2 の3番目）。写真の向きで2つの作りを自動で選ぶ（作る人の決定。11/5）
//   縦の写真 → 案A：写真を全面に。下のほうを暗くして、影を付けた白い大きな文字を写真の上に直接置く
//   横・正方形の写真 → 案B：上下にテーマ色の帯。帯の中に大きな文字。写真は切らずに真ん中に置く
// 写真はこの中で描くだけ。外には送らない

export const CARD_W = 1080
export const CARD_H = 1920

export type TextPosition = 'up' | 'normal' | 'down'
export type CardDesign = 'A' | 'B'

// 縦の写真（縦が横より1割以上長い）は案A。横と正方形は案B ⚙
// 正方形を案Bにする理由：案Aで全面に広げると、左右が4割ほど切れて顔が切れやすく、文字も写真の下半分に重なる。
// 案Bなら写真を切らずに全体を見せ、文字は帯の中なので顔に重ならない
export const designFor = (photo: { width: number; height: number } | null): CardDesign =>
  photo && photo.height < photo.width * 1.1 ? 'B' : 'A'

// Instagramのリールで、ボタンや説明文が重なる所・切れる所（端からの距離）
// 11/5 作る人が iPhone 15 Plus で、自分の投稿を再生した画面1回分で測った目安から決めた（DEVLOG 11/5）。
// ほかの人の画面や別の機種では違うことがある
//   上220まで重なる／左右は映像が55ずつ切れる／下の左側は210まで重なる／右下は右から160・下から520までボタン
// → 上220・左右64・下300（説明文が長いときの余裕を含む）。下から540までの高さでは、右を180空ける（作る人の決定）
export const SAFE = { top: 220, bottom: 300, left: 64, right: 64, cornerH: 540, cornerRight: 180 }

const INK = '#3a2e26'
const WHITE = '#ffffff'
const FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif'

// 文字の大きさ（1080×1920の中の大きさ）。作る人がiPhoneで見て「ちょうどいい」と決めた（11/5。見比べのときの「中」）
const NAME_PX = 132
const LINE_PX = 64
const SCALES = [1, 0.92, 0.84, 0.76] // 長いときは、この順に小さくする（0.76 まで）
const NAME_SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5] // 名前は本文とは別に、2行に収まるまで（0.5倍まで）

const WIDE_W = CARD_W - SAFE.left - SAFE.right // 文字を置いてよい横幅
const NARROW_W = CARD_W - SAFE.left - SAFE.cornerRight // 下から540までの高さでの横幅（右下のボタンを避ける）
const CORNER_TOP = CARD_H - SAFE.cornerH
// 上から y0〜y1 の所に置く文字の横幅。少しでも右下のボタンの高さにかかれば、狭いほう
const widthFor = (y1: number) => (y1 > CORNER_TOP ? NARROW_W : WIDE_W)
type Widths = { name: number; body: number }

export type CardLayout = {
  design: CardDesign
  fits: boolean // 名前とカードの言葉が、決めた範囲に収まったか
  scale: number // 長いので小さくした割合（1 = そのまま）
  linesShown: number // 載せたカードの言葉の数（0か1。元の行のまま。行の途中では切らない）
  linesTotal: number // 「いいところ」の行の数（空の行を除く）
  word: string | null // 載せたカードの言葉（「いいところ」の1行をそのまま）
  wordIndex: number // それが「いいところ」の何行目か（0から。載せないときは -1）
  wordRows: number // カードの言葉の行数（折り返し。2まで）。2のときは猫カードを4秒にする（SPEC 3.2）
  skippedLong: number // 長くて2行に入らないので、飛ばした行の数
  skippedSame: number // ひとことカードに載せる文と同じなので、飛ばした行の数
  contrast: number // 文字と、その後ろの色の見やすさ（4.5以上なら読みやすい）。案Aは写真の明るい所で測る
  darken: number // 案A：写真の下のほうを暗くした強さ（0〜1）
  framing?: Framing | null // 案A：実際に使った写真の位置（#29）
}

type Img = CanvasImageSource & { width: number; height: number }

// 日本語を、幅に収まるように折り返す（「、」「。」などで行を始めない）
const NO_START = '、。，．,.）」』】〕！？!?ーぁぃぅぇぉっゃゅょァィゥェォッャュョ・'
// 言葉のまとまりに分ける（issue #10：「教えてく／れる」のように言葉の途中で折らないため）
// ブラウザの言葉の区切り（Intl.Segmenter）は「教え|て|くれる」のように細かいので、
// ひらがなで始まる部分（て・を・くれる など）・閉じかっこ・句読点・「〜」は前にくっつけ、開きかっこのあとは次にくっつける。
// 数のあとの1文字（「10時」の「時」）も前にくっつける。使えないブラウザでは、英数字のつながりだけをまとめる
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ja', { granularity: 'word' }) : null
const ATTACH_BEFORE = /^[\p{Script=Hiragana}ー、。，．,.）」』】〕！？!?…〜~・：:]/u
const OPEN = /[（「『【〔(〜~]$/
// loose：「・」の後ろの言葉をつなげない（とても長い名前が3行に入らないときだけ。前の折り方）
export function wordUnits(text: string, loose = false): string[] {
  if (!segmenter) return text.match(/[A-Za-z0-9@.:/_~+-]+|./gsu) ?? []
  const segs = [...segmenter.segment(text)].map((x) => x.segment)
  const units: string[] = []
  for (let i = 0; i < segs.length; i++) {
    let segment = segs[i]
    // 「お問い合わせ」「ご連絡」の「お」「ご」は、後ろの言葉にくっつける（前にはくっつけない）
    const honor = (segment === 'お' || segment === 'ご') && /^\p{Script=Han}/u.test(segs[i + 1] ?? '')
    if (honor) segment += segs[++i]
    const prev = units[units.length - 1]
    const afterStop = prev !== undefined && /[、。，．！？!?]$/.test(prev) && !/^[、。，．！？!?）」』】〕…]/.test(segment)
    const glue =
      prev !== undefined &&
      prev !== '\n' &&
      segment !== '\n' &&
      !afterStop && // 「、」「。」のあとでは分ける
      !honor &&
      (ATTACH_BEFORE.test(segment) || OPEN.test(prev) || (!loose && /・$/.test(prev)) || (/[0-9０-９]$/.test(prev) && [...segment].length === 1 && !/\s/.test(segment)) || (/[0-9０-９:：]$/.test(prev) && /^[0-9０-９]/.test(segment)))
    if (glue) units[units.length - 1] = prev + segment
    else units.push(segment)
  }
  return units
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, loose = false): string[] {
  // 言葉のまとまりの途中では折らない（入りきらないほど長いまとまりだけ、文字で折る）
  const units = wordUnits(text, loose)
  const lines: string[] = []
  let cur = ''
  const pushChars = (u: string) => {
    for (const ch of [...u]) {
      if (ctx.measureText(cur + ch).width <= width || cur === '') cur += ch
      else if (NO_START.includes(ch) && cur.length > 1) {
        lines.push(cur.slice(0, -1))
        cur = cur.slice(-1) + ch
      } else if (cur.endsWith('・') && cur.length > 2) {
        // 「・」で行を終えない（前の1文字ごと次の行へ）
        lines.push(cur.slice(0, -2))
        cur = cur.slice(-2) + ch
      } else {
        lines.push(cur)
        cur = ch
      }
    }
  }
  for (const u of units) {
    if (ctx.measureText(cur + u).width <= width) {
      cur += u
    } else if (ctx.measureText(u.trimStart()).width <= width) {
      if (cur) lines.push(cur)
      cur = u.trimStart()
    } else {
      pushChars(u)
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
type Planned = { nameLines: string[]; prof: string[]; profSize: number; body: string[][]; nameSize: number; lineSize: number; h: number }
const NAME_LH = 1.18
const PROF_PX = 54 // 年齢と性別の1行（名前より小さく）⚙
const PROF_LH = 1.4
const PROF_GAP = 6
const LINE_LH = 1.42
const GAP = 22

function planName(ctx: CanvasRenderingContext2D, name: string, k: number, width: number) {
  for (const s of NAME_SCALES) {
    const size = Math.round(NAME_PX * k * s)
    ctx.font = `800 ${size}px ${FONT}`
    const lines = wrap(ctx, name, width)
    if (lines.length <= 2) return { size, lines }
    if (s === NAME_SCALES[NAME_SCALES.length - 1]) {
      // いちばん小さくしても3行に入らない、とても長い名前だけ、「・」の後ろでも折る（前の折り方）
      const loose = lines.length > 3 ? wrap(ctx, name, width, true) : lines
      return { size, lines: loose.length < lines.length ? loose : lines }
    }
  }
  return { size: Math.round(NAME_PX * k * 0.5), lines: [name] }
}

// nk：名前だけの大きさの係数（長い名前のとき、名前だけを先に小さくして、言葉と写真の大きさを保つため）
function plan(ctx: CanvasRenderingContext2D, name: string, profile: string, lines: string[], k: number, n: number, width: Widths, nk = k): Planned {
  const { size: nameSize, lines: nameLines } = planName(ctx, name, nk, width.name)
  const profSize = Math.round(PROF_PX * k)
  ctx.font = `600 ${profSize}px ${FONT}`
  const prof = profile.trim() ? wrap(ctx, profile.trim(), width.name) : []
  const lineSize = Math.round(LINE_PX * k)
  ctx.font = `700 ${lineSize}px ${FONT}`
  const body = lines.slice(0, n).map((l) => wrap(ctx, l, width.body))
  return { nameLines, prof, profSize, body, nameSize, lineSize, h: blockH({ nameLines, prof, profSize, body, nameSize, lineSize }) }
}
const rowsOf = (body: string[][]) => body.reduce((a, b) => a + b.length, 0)
// 名前と、その下の年齢・性別の1行（案Bでは上の帯に入る）
function nameH(p: Pick<Planned, 'nameLines' | 'nameSize' | 'prof' | 'profSize'>) {
  return p.nameLines.length * p.nameSize * NAME_LH + (p.prof.length ? PROF_GAP + p.prof.length * p.profSize * PROF_LH : 0)
}
// 「いいところ」の項目と項目のあいだは、少し空ける（折り返した行と、次の項目を見分けやすくするため。#10）⚙
const ITEM_GAP = 0.35 // 行の高さに対する割合
function bodyH(p: Pick<Planned, 'body' | 'lineSize'>) {
  return rowsOf(p.body) * p.lineSize * LINE_LH + Math.max(0, p.body.length - 1) * p.lineSize * ITEM_GAP
}
function blockH(p: Omit<Planned, 'h'>) {
  const b = bodyH(p)
  return nameH(p) + (b ? GAP + b : 0)
}

// 長いときは、まず文字を小さくする。それでも入らなければ、後ろの行から載せない（行の途中では切らない。書き換えない）
function choose(
  ctx: CanvasRenderingContext2D,
  name: string,
  profile: string,
  lines: string[],
  k: number,
  width: Widths,
  ok: (p: Planned) => boolean,
): { p: Planned; scale: number; fits: boolean } {
  for (let n = lines.length; n >= 0; n--) {
    for (const s of SCALES) {
      const p = plan(ctx, name, profile, lines, k * s, n, width)
      // カードの言葉は2行まで（SPEC 3.1。3秒〜4秒で読める長さ）
      if (p.nameLines.length <= 3 && p.body.every((rows) => rows.length <= MAX_WORD_ROWS) && ok(p)) return { p, scale: s, fits: true }
    }
  }
  const s = SCALES[SCALES.length - 1]
  return { p: plan(ctx, name, profile, [], k * s, 0, width), scale: s, fits: false }
}
const MAX_WORD_ROWS = 2

// カードの言葉を1つ選ぶ（SPEC 2.4・3.1。11/6 作る人の決定）
// 「いいところ」の上の行から順に、ひとことカードに載せる文と同じ行は飛ばし、2行に入る最初の1行を使う。書き換えない。行の途中で切らない
// 入る行がなければ、名前と年齢・性別だけにする（ツールが言葉を作らない）
type WordPick = { chosen: { p: Planned; scale: number; fits: boolean }; word: string | null; wordIndex: number; skippedLong: number; skippedSame: number }
const normWords = (t: string) => t.normalize('NFKC').replace(/[\s「」『』、。,.!！?？]/g, '')
function pickWord(lines: string[], avoid: string | null | undefined, tryOne: (lines: string[]) => { p: Planned; scale: number; fits: boolean }): WordPick {
  let skippedLong = 0
  let skippedSame = 0
  const av = avoid ? normWords(avoid) : ''
  for (let i = 0; i < lines.length; i++) {
    const w = normWords(lines[i])
    if (av && w && av.includes(w)) {
      skippedSame++
      continue
    }
    const chosen = tryOne([lines[i]])
    if (chosen.p.body.length === 1) return { chosen, word: lines[i], wordIndex: i, skippedLong, skippedSame }
    skippedLong++
  }
  return { chosen: tryOne([]), word: null, wordIndex: -1, skippedLong, skippedSame }
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
    // 年齢と性別の1行（例「推定2歳・男の子」）。名前より小さく、少しだけ薄く
    if (p.prof.length) {
      y += PROF_GAP
      ctx.font = `600 ${p.profSize}px ${FONT}`
      ctx.globalAlpha = 0.92
      for (const l of p.prof) {
        ctx.fillText(l, x, y + p.profSize * 0.1)
        widest = Math.max(widest, ctx.measureText(l).width)
        y += p.profSize * PROF_LH
      }
      ctx.globalAlpha = 1
    }
    if (parts === 'all' && p.body.length) y += GAP
  }
  if (parts !== 'name') {
    ctx.font = `700 ${p.lineSize}px ${FONT}`
    p.body.forEach((rows, i) => {
      if (i > 0) y += p.lineSize * ITEM_GAP
      for (const r of rows) {
        ctx.fillText(r, x, y + p.lineSize * 0.12)
        widest = Math.max(widest, ctx.measureText(r).width)
        y += p.lineSize * LINE_LH
      }
    })
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
  profile?: string // 年齢と性別の1行（例「推定2歳・男の子」。不明な項目は入れない。両方不明なら空）
  lines: string[] // カードの言葉の候補（「いいところ」の行をそのまま。この中から1つだけ載せる）
  avoid?: string | null // ひとことカードに載せる文（同じ行はカードの言葉に使わない）
  theme: string
  position: TextPosition
  framing?: Framing // 写真の位置（#29。案Aだけ）
}

export function drawCatCard(ctx: CanvasRenderingContext2D, opts: Opts): CardLayout {
  const lines = opts.lines.map((l) => l.trim()).filter(Boolean)
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  return designFor(opts.photo) === 'B' ? drawB(ctx, opts, lines) : drawA(ctx, opts, lines)
}

// 案A：写真を全面に。下のほうを暗くして、白い大きな文字
const A_MAX_H = 760 // 文字のかたまりの高さの上限（写真が主役。カードの4割まで）⚙
const A_LIFT: Record<TextPosition, number> = { down: 0, normal: 140, up: 300 } // 下の安全な所から、どれだけ上げるか ⚙

function drawA(ctx: CanvasRenderingContext2D, opts: Opts, lines: string[]): CardLayout {
  ctx.fillStyle = '#6b5f55'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  const used = opts.photo ? drawFramed(ctx, opts.photo, 0, 0, CARD_W, CARD_H, 0.5, opts.framing ?? NO_FRAMING) : null

  const bottom = CARD_H - SAFE.bottom - A_LIFT[opts.position]
  const w = widthFor(bottom)
  const profile = opts.profile ?? ''
  const pick = pickWord(lines, opts.avoid, (ls) => choose(ctx, opts.name, profile, ls, 1, { name: w, body: w }, (p) => p.h <= A_MAX_H))
  const { p, scale, fits } = pick.chosen
  const top = bottom - p.h

  // 暗くする強さ：文字の後ろの明るい所でも、白い文字が読める（見やすさ4.5以上）まで。最低0.35、最大0.85
  const [r, g, b] = brightLums(ctx, SAFE.left, top, w, p.h)
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

  // ロゴは表紙と最後の1枚だけ（猫カード・ひとことカードには入れない。11/6 作者の決定）
  const t = drawText(ctx, p, SAFE.left, top, WHITE, 'left', true)

  return {
    design: 'A',
    fits: fits && t.widest <= w + 0.5 && top >= SAFE.top + 120 && t.bottom <= bottom + 1,
    scale,
    ...wordInfo(pick, p, lines),
    contrast: round1(ratio(1, after(darken))),
    darken: round1(darken * 100) / 100,
    framing: used,
  }
}

const wordInfo = (pick: WordPick, p: Planned, lines: string[]) => ({
  linesShown: p.body.length,
  linesTotal: lines.length,
  word: pick.word,
  wordIndex: pick.wordIndex,
  wordRows: p.body[0]?.length ?? 0,
  skippedLong: pick.skippedLong,
  skippedSame: pick.skippedSame,
})

// 帯の色と文字の色を決める
function bandColors(theme: string): { band: string; color: string; contrast: number } {
  const n = parseInt(theme.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const inkLum = hexLum(INK)
  const white = ratio(1, lum(rgb[0], rgb[1], rgb[2]))
  const ink = ratio(inkLum, lum(rgb[0], rgb[1], rgb[2]))
  const useWhite = white >= ink
  const textLum = useWhite ? 1 : inkLum
  const toward = useWhite ? 0 : 255 // 白い文字なら帯を暗く、濃い文字なら帯を明るく
  let t = 0
  let c = rgb
  while (ratio(textLum, lum(c[0], c[1], c[2])) < 4.5 && t < 1) {
    t = Math.min(1, t + 0.02)
    c = rgb.map((v) => Math.round(v + (toward - v) * t))
  }
  const hex = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
  return { band: hex, color: useWhite ? WHITE : INK, contrast: ratio(textLum, lum(c[0], c[1], c[2])) }
}

// 案B：上下にテーマ色の帯。上の帯に大きな文字（名前・年齢と性別・カードの言葉）。写真は切らずに、帯のあいだに
const B_PAD = 36 // 帯の中の、文字の上下の余白
const B_LOGO = 90 // 案Bのロゴは少し小さく（帯を低くするため）
const B_MIN_PHOTO = 700 // 写真に残す高さの下限 ⚙
// カードの言葉がふつうの写真の高さでは入らないときだけ、写真をここまで小さくしてよい（できるだけ言葉を載せるため。#10）⚙
const B_MIN_PHOTO_TWO = 560

function drawB(ctx: CanvasRenderingContext2D, opts: Opts, lines: string[]): CardLayout {
  // 帯の文字は、白と濃い色のうち、テーマ色の上で読みやすいほう（見直し A13 と同じ考え）
  // どちらも見やすさ4.5に届かない中くらいの色のときは、帯の色だけを少し暗く（白い文字）か明るく（濃い文字）して4.5にそろえる。
  // テーマ色の設定は変えない（11/5 見直し①の1番。作る人の決定）
  const { band, color, contrast } = bandColors(opts.theme)
  const logoH = 0 // 猫カードにはロゴを入れない（11/6 作者の決定）

  // 文字はすべて上の帯に、上から「名前 → 年齢と性別 → カードの言葉」（11/6 作る人の決定）。
  // 下の帯はInstagramの表示（説明文・ボタン）で隠れやすいので、文字を置かない。写真も下300には入れない
  const bands = (p: Planned) => ({ topH: SAFE.top + logoH + p.h + B_PAD, botH: SAFE.bottom })
  // 上の帯の文字は、右下のボタンの高さ（下から540）より上に収める。そこまでは左右64だけ空ければよい
  const roomFor = (minPhoto: number) => (p: Planned) => {
    const { topH, botH } = bands(p)
    return CARD_H - topH - botH >= minPhoto && topH - B_PAD <= CORNER_TOP
  }
  const profile = opts.profile ?? ''
  // 言葉が入らないときだけ、写真を少し小さくしてでも載せる
  const pick = pickWord(lines, opts.avoid, (ls) => {
    // 長い名前やロゴで上の帯が高くなるときは、まず名前だけを小さくする（言葉はほかのカードと同じ大きさ・折り返しのまま、写真も小さくしすぎない。11/6 作者の指示）⚙
    for (const nk of [1, 0.85, 0.72]) {
      const p = plan(ctx, opts.name, profile, ls, 1, ls.length, { name: WIDE_W, body: WIDE_W }, nk)
      if (p.nameLines.length <= 2 && p.body.every((rows) => rows.length <= MAX_WORD_ROWS) && roomFor(B_MIN_PHOTO)(p)) return { p, scale: 1, fits: true }
    }
    const c = choose(ctx, opts.name, profile, ls, 1, { name: WIDE_W, body: WIDE_W }, roomFor(B_MIN_PHOTO))
    if (ls.length && c.p.body.length < ls.length) {
      const more = choose(ctx, opts.name, profile, ls, 1, { name: WIDE_W, body: WIDE_W }, roomFor(B_MIN_PHOTO_TWO))
      if (more.fits && more.p.body.length === ls.length) return more
    }
    return c
  })
  const { p, scale, fits } = pick.chosen
  const { topH, botH } = bands(p)

  ctx.fillStyle = band
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (opts.photo) drawContain(ctx, opts.photo, 0, topH, CARD_W, CARD_H - topH - botH)

  // ロゴは表紙と最後の1枚だけ（猫カード・ひとことカードには入れない。11/6 作者の決定）
  const t = drawText(ctx, p, SAFE.left + WIDE_W / 2, SAFE.top + logoH, color, 'center', false, 'all')

  return {
    design: 'B',
    fits: fits && t.widest <= WIDE_W + 0.5 && t.bottom <= topH && t.bottom <= CORNER_TOP + 1,
    scale,
    ...wordInfo(pick, p, lines),
    contrast: round1(contrast),
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

// ── 小さなクローバー（飾り。画像は使わず、図形で描く）──
// 葉を少し離して、四つ葉とわかる形にする。表紙は緑の葉に白いふち（11/5夜 作者が見本の案2を選んだ。少し大きめ）
const CLOVER_GREEN = '#5f9e5a'
type CloverStyle = { fill: string; outline?: string; vein?: string; stem?: string }
function leafPath(ctx: CanvasRenderingContext2D, r: number, gap: number) {
  ctx.beginPath()
  ctx.moveTo(0, -gap)
  ctx.bezierCurveTo(-r * 0.95, -gap - r * 0.35, -r * 0.8, -gap - r * 1.2, 0, -gap - r * 0.8)
  ctx.bezierCurveTo(r * 0.8, -gap - r * 1.2, r * 0.95, -gap - r * 0.35, 0, -gap)
}
export function drawClover(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, style: CloverStyle) {
  const gap = r * 0.2
  ctx.save()
  ctx.translate(cx, cy)
  const leaves = (scale: number, color: string) => {
    ctx.fillStyle = color
    for (let i = 0; i < 4; i++) {
      ctx.save()
      ctx.rotate((Math.PI / 2) * i + Math.PI / 4)
      ctx.scale(scale, scale)
      leafPath(ctx, r, gap / scale)
      ctx.fill()
      ctx.restore()
    }
  }
  if (style.outline) leaves(1.18, style.outline) // 白いふち（写真の上でも形が見えるように）
  leaves(1, style.fill)
  if (style.vein) {
    ctx.strokeStyle = style.vein
    ctx.lineWidth = Math.max(1.5, r * 0.06)
    for (let i = 0; i < 4; i++) {
      ctx.save()
      ctx.rotate((Math.PI / 2) * i + Math.PI / 4)
      ctx.beginPath()
      ctx.moveTo(0, -gap)
      ctx.lineTo(0, -gap - r * 0.75)
      ctx.stroke()
      ctx.restore()
    }
  }
  // 茎
  ctx.strokeStyle = style.stem ?? style.fill
  ctx.lineWidth = Math.max(2, r * 0.12)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, r * 0.1)
  ctx.quadraticCurveTo(r * 0.35, r * 0.8, r * 0.15, r * 1.3)
  ctx.stroke()
  ctx.restore()
}
const COVER_CLOVER: CloverStyle = { fill: CLOVER_GREEN, outline: WHITE, vein: 'rgba(255,255,255,0.7)', stem: WHITE }

// ── 表紙（SPEC 3.2 の1番目）：写真1枚目・「ずっとのおうちを探しています」・「○○です」・小さなクローバー ──
// 言葉は決まった文で、入力にない事実を足さない（11/5夜 作者の決定）。名前は猫カードと同じく下のほう（11/5 作者の決定）
export const COVER_GREETING = 'ずっとのおうちを探しています'
export type CoverLayout = { design: CardDesign; fits: boolean; contrast: number; nameSize: number }
const GREET_PX = 60
const GREET_GAP = 18

// 決まった言葉を、横幅に入る大きさで1行にする（入らなければ小さくする。言葉は変えない）
function planGreeting(ctx: CanvasRenderingContext2D, k: number, width: number) {
  for (const s of [1, 0.92, 0.84, 0.76, 0.68]) {
    const size = Math.round(GREET_PX * k * s)
    ctx.font = `700 ${size}px ${FONT}`
    if (ctx.measureText(COVER_GREETING).width <= width) return size
  }
  return Math.round(GREET_PX * k * 0.68)
}
function drawGreeting(ctx: CanvasRenderingContext2D, size: number, y: number, color: string, shadow: boolean) {
  ctx.save()
  ctx.font = `700 ${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 14
    ctx.shadowOffsetY = 2
  }
  ctx.fillText(COVER_GREETING, CARD_W / 2, y)
  const w = ctx.measureText(COVER_GREETING).width
  ctx.restore()
  return w
}

export function drawCoverCard(
  ctx: CanvasRenderingContext2D,
  opts: { photo: Img | null; logo: Img | null; name: string; theme: string },
): CoverLayout {
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  const design = designFor(opts.photo)
  const title = opts.name.trim() ? `${opts.name.trim()}です` : ''
  if (design === 'B') {
    // 横・正方形の写真：猫カードの案Bと同じく、上下にテーマ色の帯。言葉と名前は上の帯、クローバーは下の帯
    const { band, color, contrast } = bandColors(opts.theme)
    const logoH = opts.logo ? B_LOGO + 14 : 0
    const gSize = planGreeting(ctx, 0.9, WIDE_W)
    const { size, lines } = planName(ctx, title, 1.0, WIDE_W)
    const textTop = SAFE.top + logoH
    const nameTop = textTop + gSize * 1.2 + GREET_GAP
    const topH = nameTop + lines.length * size * NAME_LH + B_PAD
    const botH = SAFE.bottom + 170
    ctx.fillStyle = band
    ctx.fillRect(0, 0, CARD_W, CARD_H)
    if (opts.photo) drawContain(ctx, opts.photo, 0, topH, CARD_W, CARD_H - topH - botH)
    drawLogo(ctx, opts.logo, SAFE.left, SAFE.top, B_LOGO)
    const gw = drawGreeting(ctx, gSize, textTop, color, false)
    const p: Planned = { nameLines: lines, prof: [], profSize: 0, body: [], nameSize: size, lineSize: 0, h: 0 }
    const n = drawText(ctx, p, CARD_W / 2, nameTop, color, 'center', false, 'name')
    drawClover(ctx, CARD_W / 2, CARD_H - botH + 70, 40, COVER_CLOVER)
    return { design, fits: gw <= WIDE_W + 0.5 && n.widest <= WIDE_W + 0.5 && n.bottom <= topH, contrast: round1(contrast), nameSize: size }
  }

  // 縦の写真：写真を全面に。言葉と名前は白い文字（影つき）
  ctx.fillStyle = '#6b5f55'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (opts.photo) drawCover(ctx, opts.photo, 0, 0, CARD_W, CARD_H)
  const gSize = planGreeting(ctx, 1, WIDE_W)
  const { size, lines } = planName(ctx, title, 1.1, WIDE_W)
  const nameH = lines.length * size * NAME_LH
  const h = gSize * 1.2 + GREET_GAP + nameH // 言葉＋名前のかたまり
  const cloverR = 34
  // 猫カードの名前と同じあたり（下のほう）。真ん中にそろえるので、右下のボタンの高さ（下から540）より上に置く
  const top = CORNER_TOP - 10 - h
  const [r, g, b] = brightLums(ctx, SAFE.left, top, WIDE_W, h)
  let darken = 0.3
  const after = (a: number) => lum(r * (1 - a), g * (1 - a), b * (1 - a))
  while (darken < 0.85 && ratio(1, after(darken)) < 4.5) darken = Math.min(0.85, darken + 0.05)
  // 言葉と名前の周りだけを、上下にぼかして暗くする
  const pad = 220
  const grad = ctx.createLinearGradient(0, top - pad, 0, top + h + pad)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(0.35, `rgba(0,0,0,${darken})`)
  grad.addColorStop(0.65, `rgba(0,0,0,${darken})`)
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, top - pad, CARD_W, h + pad * 2)
  drawLogo(ctx, opts.logo, SAFE.left, SAFE.top)
  const gw = drawGreeting(ctx, gSize, top, WHITE, true)
  const p: Planned = { nameLines: lines, prof: [], profSize: 0, body: [], nameSize: size, lineSize: 0, h: nameH }
  const n = drawText(ctx, p, CARD_W / 2, top + gSize * 1.2 + GREET_GAP, WHITE, 'center', true, 'name')
  const cloverY = top - cloverR * 1.3 - 26
  drawClover(ctx, CARD_W / 2, cloverY, cloverR, COVER_CLOVER)
  const w = widthFor(n.bottom)
  return {
    design,
    fits: gw <= WIDE_W + 0.5 && n.widest <= w + 0.5 && cloverY - cloverR * 1.5 >= SAFE.top && n.bottom <= CARD_H - SAFE.bottom,
    contrast: round1(ratio(1, after(darken))),
    nameSize: size,
  }
}

// ── 最後の1枚（SPEC 3.2 の5番目）：次の譲渡会の日時・場所、団体名、ロゴ、連絡先 ──
// 上に写真、下に便箋（SPEC 3.1。11/5夜 作る人の決定）
export type EndEvent = { date: string; startTime: string; endTime: string; venue: string }
export type EndLayout = { fits: boolean; scale: number; hasEvent: boolean; contrast: number }

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
export function eventDateText(e: EndEvent): string {
  const [y, m, d] = e.date.split('-').map(Number)
  if (!y || !m || !d) return e.date
  return `${m}月${d}日（${WEEK[new Date(y, m - 1, d).getDay()]}）`
}
export const eventTimeText = (e: EndEvent) => (e.startTime ? `${e.startTime}〜${e.endTime}` : '')
const PAPER = '#fbf6ee'

// drawEndCard は、下の「便箋のカード」のところ

// ── 撮った動画に重ねる名前（SPEC 3.2 の2番目）──
// 表紙と同じ置き方（下。右下のボタンの高さより上、真ん中にそろえる）で、少し小さく（11/5 作る人の決定）
// area：横・正方形の動画を帯つきで置いたときの、映像の上下（縦の動画は画面いっぱいなので null）
// 横の動画では、名前が映像の下の端をまたぐと切れて見えるので、表紙の案Bと同じく映像の上の帯に置く（11/6 作者が見本で気づいた）。
// 上の帯に入らないとき（正方形に近い動画）は、映像の中の下のほうに収める
export function drawClipName(ctx: CanvasRenderingContext2D, name: string, area: { top: number; bottom: number } | null = null): { top: number; bottom: number } | null {
  if (!name.trim()) return null
  const { size, lines } = planName(ctx, name, 0.8, WIDE_W)
  const h = lines.length * size * NAME_LH
  let top = CORNER_TOP - 10 - h
  let onBand = false // 映像の上の帯（無地）に置くときは、後ろを暗くしない（映像の上の端が暗くならないように）
  if (area) {
    const above = area.top - 28 - h
    onBand = above >= SAFE.top
    top = onBand ? above : Math.min(CORNER_TOP - 10, area.bottom - 28) - h
  }
  const p: Planned = { nameLines: lines, prof: [], profSize: 0, body: [], nameSize: size, lineSize: 0, h }
  if (onBand) {
    drawText(ctx, p, CARD_W / 2, top, WHITE, 'center', true, 'name')
    return { top, bottom: top + h }
  }
  const pad = 160
  const grad = ctx.createLinearGradient(0, top - pad, 0, top + h + pad)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(0.4, 'rgba(0,0,0,0.35)')
  grad.addColorStop(0.6, 'rgba(0,0,0,0.35)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, top - pad, CARD_W, h + pad * 2)
  drawText(ctx, p, CARD_W / 2, top, WHITE, 'center', true, 'name')
  return { top, bottom: top + h }
}

// ── ひとことカード（SPEC 3.2 の4番目。issue #28）──
// 上に写真、下の便箋に、預かりさん・スタッフさんのひとことを、書き換えずにそのまま載せる（「 」で囲むだけ）。
// 「預かりさんより」は付けない（スタッフさんの言葉のこともあり、入力にない事実になるため）
export type WordsLayout = { fits: boolean; scale: number; sec: number }

// 長さで3〜5秒（SPEC 3.2）⚙：30字まで3秒、60字まで4秒、それより長いと5秒
export const wordsSec = (text: string) => {
  const n = [...text.replace(/\s/g, '')].length
  return n <= 30 ? 3 : n <= 60 ? 4 : 5
}

// 文に分ける（「。」「！」「？」・改行のところ。文の途中では切らない）。つなげると元の文に戻る
export function splitSentences(text: string): string[] {
  return text.match(/[^。！？!?\n]*(?:[。！？!?]+[」』）)]*|\n|$)/g)?.filter((s) => s !== '') ?? [text]
}

// ── 便箋のカード（ひとことカード・最後の1枚。SPEC 3.1・3.2。11/5夜 作る人の決定）──
// 上に写真を大きく、下に便箋。便箋は上から1000〜1600（画面の約3分の1）。隠れる所を避け、文字は右下のボタンの線（右180）より左だけ
export type Framing = { x: number; y: number; scale: number } // 写真の位置（#29。指で動かした分。scale は1以上）
const NO_FRAMING: Framing = { x: 0, y: 0, scale: 1 }
export const LETTER = { x: SAFE.left, y: 1000, w: CARD_W - SAFE.left * 2, h: 600 }
const LETTER_TEXT = { x: SAFE.left + 48, right: CARD_W - SAFE.cornerRight - 16 }
const LETTER_TOP_H = 1300 // 縦の写真を入れる高さ（便箋の後ろまで少し入れ、顔が便箋より上に来るように）
const FACE_AT = 0.42 // 顔は写真の上から4割くらいにあると見る ⚙（Claudeは写真を見ない。合わないときは人が指で動かす）

// 写真を、枠いっぱいに切って入れる。focusY：写真のどの高さを枠の真ん中に寄せるか。framing：人が指で動かした分
// 返すのは、実際に使った位置（枠からはみ出さないように止めたあとの値。指で動かす画面が、止まった所から動かせるように）
export function drawFramed(ctx: CanvasRenderingContext2D, img: Img, x: number, y: number, w: number, h: number, focusY = 0.5, framing: Framing = NO_FRAMING): Framing {
  const k = Math.min(MAX_SCALE, Math.max(1, framing.scale))
  const s = Math.max(w / img.width, h / img.height) * k
  const dw = img.width * s
  const dh = img.height * s
  // 寄せたい高さが枠の真ん中に来るように。ただし枠からはみ出さない（すき間を作らない）
  const baseX = x + (w - dw) / 2
  const baseY = Math.min(y, Math.max(y + h - dh, y + h / 2 - dh * focusY))
  const dx = Math.min(x, Math.max(x + w - dw, baseX + framing.x))
  const dy = Math.min(y, Math.max(y + h - dh, baseY + framing.y))
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.restore()
  return { x: dx - baseX, y: dy - baseY, scale: k }
}
export const MAX_SCALE = 3 // 写真を大きくできるのは3倍まで ⚙

// 上の写真。縦の写真は上に寄せて入れ、横の写真は切らずに全体を入れる。まわりはぼかした同じ写真で埋める
function drawLetterPhoto(ctx: CanvasRenderingContext2D, photo: Img | null, framing: Framing): Framing | null {
  ctx.fillStyle = '#6b5f55'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (!photo) return null
  // まわり：ぼかした写真（ぼかせないブラウザでは、少し暗くするだけ）
  ctx.save()
  ctx.filter = 'blur(28px)'
  drawFramed(ctx, photo, -40, -40, CARD_W + 80, CARD_H + 80)
  ctx.restore()
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (photo.height >= photo.width * 1.1) {
    // 写真の下の端は、ぼかした写真にだんだん溶けこませる（境目が線に見えないように）
    const t = document.createElement('canvas')
    t.width = CARD_W
    t.height = LETTER_TOP_H
    const tc = t.getContext('2d')
    if (tc) {
      const used = drawFramed(tc, photo, 0, 0, CARD_W, LETTER_TOP_H, FACE_AT, framing)
      tc.globalCompositeOperation = 'destination-in'
      const g = tc.createLinearGradient(0, LETTER_TOP_H - 220, 0, LETTER_TOP_H)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      // 1回で全体に重ねる（分けて重ねると、重ねなかった所が消えるため）
      tc.fillStyle = g
      tc.fillRect(0, 0, CARD_W, LETTER_TOP_H)
      ctx.drawImage(t, 0, 0)
      return used
    }
    return drawFramed(ctx, photo, 0, 0, CARD_W, LETTER_TOP_H, FACE_AT, framing)
  } else {
    // 横・正方形の写真：横幅いっぱいに、切らずに。上の隠れる所の下から、便箋の上まで
    const h = Math.min((CARD_W * photo.height) / photo.width, LETTER.y + 40 - SAFE.top)
    return drawFramed(ctx, photo, 0, SAFE.top, CARD_W, h, 0.5, framing)
  }
}

// テーマ色を、紙の色の上で読める濃さまで暗くする（見出しの文字に使う）
function inkOfTheme(theme: string): string {
  const n = parseInt(theme.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  let c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const paper = hexLum(PAPER)
  for (let t = 0; t < 1 && ratio(lum(c[0], c[1], c[2]), paper) < 4.5; t += 0.05) c = c.map((v) => Math.round(v * 0.95))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

// 切手（ぎざぎざの縁。中はテーマ色にクローバー）と、文字のない消印
function drawStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, theme: string) {
  const w = 120
  const h = 142
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(0.07)
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2
  // 縁のぎざぎざ：白い四角から、まわりの小さな丸を抜く（別の絵を用意して、上に重ねる）
  const c = document.createElement('canvas')
  c.width = w + 20
  c.height = h + 20
  const s = c.getContext('2d')
  if (s) {
    s.translate(10, 10)
    s.fillStyle = '#fffdf8'
    s.fillRect(0, 0, w, h)
    s.globalCompositeOperation = 'destination-out'
    for (let px = 0; px <= w; px += 16) for (const py of [0, h]) {
      s.beginPath()
      s.arc(px, py, 5, 0, Math.PI * 2)
      s.fill()
    }
    for (let py = 0; py <= h; py += 16) for (const px of [0, w]) {
      s.beginPath()
      s.arc(px, py, 5, 0, Math.PI * 2)
      s.fill()
    }
    s.globalCompositeOperation = 'source-over'
    s.fillStyle = theme
    s.fillRect(12, 12, w - 24, h - 24)
    ctx.drawImage(c, -w / 2 - 10, -h / 2 - 10)
  }
  ctx.shadowColor = 'transparent'
  drawClover(ctx, 0, -6, 24, COVER_CLOVER)
  ctx.restore()
  // 消印：二重の丸と波線（文字なし）
  const mx = cx - 70
  const my = cy + 20
  const r = 52
  ctx.save()
  ctx.strokeStyle = INK
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(mx, my, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(mx, my, r * 0.72, 0, Math.PI * 2)
  ctx.stroke()
  for (let k = 0; k < 3; k++) {
    const y = my - r * 0.3 + k * r * 0.3
    ctx.beginPath()
    ctx.moveTo(mx - r * 2.4, y)
    for (let i = 0; i < 4; i++) ctx.quadraticCurveTo(mx - r * 2.4 + i * 34 + 17, y + (i % 2 ? -8 : 8), mx - r * 2.4 + (i + 1) * 34, y)
    ctx.stroke()
  }
  ctx.restore()
}

// 便箋（紙の色・テーマ色の線・うすい罫線・切手と消印）
function drawLetterPaper(ctx: CanvasRenderingContext2D, theme: string) {
  const L = LETTER
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 8
  ctx.fillStyle = PAPER
  ctx.fillRect(L.x, L.y, L.w, L.h)
  ctx.restore()
  ctx.fillStyle = theme
  ctx.fillRect(L.x, L.y, L.w, 12)
  drawStamp(ctx, L.x + L.w - 80, L.y + 10, theme)
}

const WORDS_SIZES = [46, 44, 42] // ひとことの文字の大きさ（通常46px、長いときは42pxまで。作る人の決定）
const LETTER_LH = 1.6

export function drawWordsCard(
  ctx: CanvasRenderingContext2D,
  opts: { text: string; logo: Img | null; theme: string; photo?: Img | null; framing?: Framing },
): WordsLayout & { size: number; lines: number; framing: Framing | null } {
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  const used = drawLetterPhoto(ctx, opts.photo ?? null, opts.framing ?? NO_FRAMING)
  // ロゴは表紙と最後の1枚だけ（猫カード・ひとことカードには入れない。11/6 作者の決定）
  drawLetterPaper(ctx, opts.theme)
  const L = LETTER
  ctx.fillStyle = inkOfTheme(opts.theme)
  ctx.font = `800 40px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText('ひとこと', LETTER_TEXT.x, L.y + 50)
  const quoted = `「${opts.text.trim()}」`
  const top = L.y + 128
  const bottom = L.y + L.h - 24
  const width = LETTER_TEXT.right - LETTER_TEXT.x
  let size = WORDS_SIZES[0]
  let lines: string[] = []
  for (const px of WORDS_SIZES) {
    size = px
    ctx.font = `700 ${px}px ${FONT}`
    lines = quoted.split('\n').flatMap((para) => (para ? wrap(ctx, para, width) : ['']))
    if (top + lines.length * px * LETTER_LH <= bottom) break
  }
  const fits = top + lines.length * size * LETTER_LH <= bottom
  ctx.fillStyle = INK
  let y = top
  for (const l of lines) {
    if (y + size > bottom + 1) break // 入りきらない行は描かない（fits=false で知らせる）
    ctx.fillText(l, LETTER_TEXT.x, y)
    y += size * LETTER_LH
  }
  return { fits, scale: size / WORDS_SIZES[0], sec: wordsSec(opts.text), size, lines: lines.length, framing: used }
}

export function drawEndCard(
  ctx: CanvasRenderingContext2D,
  opts: { logo: Img | null; shelterName: string; contact: string; event: EndEvent | null; theme: string; photo?: Img | null; framing?: Framing },
): EndLayout & { framing: Framing | null } {
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  const used = drawLetterPhoto(ctx, opts.photo ?? null, opts.framing ?? NO_FRAMING)
  drawLetterPaper(ctx, opts.theme)
  const L = LETTER
  const head = inkOfTheme(opts.theme)
  const contactLines = opts.contact
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  // ロゴは便箋の左上に（SPEC 3.1。11/5夜 作る人の決定）。文字はロゴの下から
  const LOGO = opts.logo ? 110 : 0
  type Row = { text: string; px: number; weight: number; color: string; gap: number }
  const build = (k: number): Row[] => {
    const rows: Row[] = []
    if (opts.event) {
      rows.push({ text: '次の譲渡会', px: 40 * k, weight: 800, color: head, gap: 0 })
      const time = eventTimeText(opts.event)
      rows.push({ text: eventDateText(opts.event), px: 58 * k, weight: 800, color: INK, gap: 14 * k })
      if (time) rows.push({ text: time, px: 50 * k, weight: 800, color: INK, gap: 2 * k })
      if (opts.event.venue) rows.push({ text: opts.event.venue, px: 46 * k, weight: 700, color: INK, gap: 8 * k })
    }
    rows.push({ text: opts.shelterName, px: 54 * k, weight: 800, color: INK, gap: opts.event ? 34 * k : 0 })
    contactLines.forEach((t, i) => rows.push({ text: t, px: 40 * k, weight: 600, color: INK, gap: (i === 0 ? 14 : 4) * k }))
    return rows
  }
  const LH = 1.3
  const top = L.y + 44 + (LOGO ? LOGO + 18 : 0)
  const bottom = L.y + L.h - 24
  const width = LETTER_TEXT.right - LETTER_TEXT.x
  let k = 1
  let laid: { lines: string[]; row: Row; y: number }[] = []
  let total = 0
  for (const s of [1, 0.92, 0.84, 0.76, 0.68, 0.6]) {
    k = s
    laid = []
    let y = 0
    for (const row of build(k)) {
      ctx.font = `${row.weight} ${Math.round(row.px)}px ${FONT}`
      y += row.gap
      const lines = wrap(ctx, row.text, width)
      laid.push({ lines, row, y })
      y += lines.length * row.px * LH
    }
    total = y
    if (top + total <= bottom) break
  }
  const fits = top + total <= bottom
  if (opts.logo) {
    const s = LOGO / Math.max(opts.logo.width, opts.logo.height)
    ctx.drawImage(opts.logo, LETTER_TEXT.x, L.y + 44, opts.logo.width * s, opts.logo.height * s)
  }
  // 譲渡会がないとき（文字が少ないとき）は、便箋の中の真ん中あたりに
  const y0 = top + Math.max(0, (bottom - top - total) / 2) * (opts.event ? 0 : 1)
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  for (const { lines, row, y } of laid) {
    ctx.font = `${row.weight} ${Math.round(row.px)}px ${FONT}`
    ctx.fillStyle = row.color
    let yy = y0 + y
    for (const l of lines) {
      if (yy + row.px > bottom + 1) break
      ctx.fillText(l, LETTER_TEXT.x, yy + row.px * 0.08)
      yy += row.px * LH
    }
  }
  return { fits, scale: k, hasEvent: !!opts.event, contrast: round1(ratio(hexLum(INK), hexLum(PAPER))), framing: used }
}
