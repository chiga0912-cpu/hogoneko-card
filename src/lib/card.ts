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
  linesShown: number // 載せたカードの言葉の数（0〜2。元の行のまま。行の途中では切らない）
  linesTotal: number // 「いいところ」の行の数（空の行を除く）
  word: string | null // 載せた1つ目の言葉（「いいところ」の1行をそのまま）
  wordIndex: number // それが「いいところ」の何行目か（0から。載せないときは -1）
  words: string[] // 載せた言葉（2つまで）
  wordIndexes: number[] // それぞれが「いいところ」の何行目か
  wordRows: number // 1つ目の言葉の行数（折り返し。2まで）
  skippedLong: number // 長くて2行に入らない（または文字が多くて入らない）ので、飛ばした行の数
  longLines: string[] // その行（元のまま）
  skippedSame: number // ひとことカードに載せる文と同じなので、飛ばした行の数
  contrast: number // 文字と、その後ろの色の見やすさ（4.5以上なら読みやすい）。案Aは写真の明るい所で測る
  darken: number // 案A：写真の下のほうを暗くした強さ（0〜1）
  framing?: Framing | null // 案A：実際に使った写真の位置（#29）
}

import { yellowInk } from './themeInk.ts' // 拡張子つき：logo.ts と同じ理由
import { drawLogoCircle } from './logo.ts' // 拡張子つき：自動の確認（scripts/wrap-check.mjs）が Node でこのファイルを直接読むため

type Img = CanvasImageSource & { width: number; height: number }

// ロゴは丸いアイコン（Instagramのアイコンと同じ。src/lib/logo.ts。11/7 作る人の決定）

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

// 団体名：最後の1文字だけが次の行に落ちないように、前の行の終わりから文字を移す（11/6夜 作者の決定）
export function wrapName(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines = wrap(ctx, text, width)
  if (lines.length < 2) return lines
  const prev = [...lines[lines.length - 2]]
  const last = [...lines[lines.length - 1]]
  while ((last.length < 2 || NO_START.includes(last[0])) && prev.length > 2) last.unshift(prev.pop()!)
  return [...lines.slice(0, -2), prev.join(''), last.join('')]
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

// カードの言葉を2つまで選ぶ（SPEC 2.4・3.1。11/6夜 作る人の決定。11/6 は1つ）
// 「いいところ」の上の行から順に、ひとことカードに載せる文と同じ行は飛ばし、1つ2行までで入る行を足していく。書き換えない。行の途中で切らない
// 入らない行（長い・文字が多くて顔にかかる）は飛ばして、画面で知らせる。入る行がなければ、名前と年齢・性別だけにする（ツールが言葉を作らない）
const MAX_WORDS = 2
type WordPick = { chosen: { p: Planned; scale: number; fits: boolean }; words: string[]; indexes: number[]; skippedLong: number; skippedSame: number; longLines: string[] }
const normWords = (t: string) => t.normalize('NFKC').replace(/[\s「」『』、。,.!！?？]/g, '')
function pickWords(lines: string[], avoid: string | null | undefined, tryWith: (lines: string[]) => { p: Planned; scale: number; fits: boolean }): WordPick {
  let skippedLong = 0
  let skippedSame = 0
  const av = avoid ? normWords(avoid) : ''
  let words: string[] = []
  let indexes: number[] = []
  const longLines: string[] = [] // 長くて（または文字が多くて）入らなかった行（#19 の短い言葉の案に使う）
  let chosen = tryWith([])
  for (let i = 0; i < lines.length && words.length < MAX_WORDS; i++) {
    const w = normWords(lines[i])
    if (av && w && av.includes(w)) {
      skippedSame++
      continue
    }
    const t = tryWith([...words, lines[i]])
    if (t.p.body.length === words.length + 1) {
      words = [...words, lines[i]]
      indexes = [...indexes, i]
      chosen = t
    } else {
      skippedLong++
      longLines.push(lines[i])
    }
  }
  return { chosen, words, indexes, skippedLong, skippedSame, longLines }
}

function drawContain(ctx: CanvasRenderingContext2D, img: Img, x: number, y: number, w: number, h: number) {
  // 切らずに、枠の中に全体を入れる
  const s = Math.min(w / img.width, h / img.height)
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s)
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
  pattern?: Img | null // 帯の柄（SPEC 3.1。案Bだけ。なければテーマ色の無地）
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
  // 文字は顔にかからない高さ（FACE_LINE より下）まで。入らない言葉は載せずに知らせる（11/6夜 作者の決定）
  const pick = pickWords(lines, opts.avoid, (ls) => choose(ctx, opts.name, profile, ls, 1, { name: w, body: w }, (p) => p.h <= A_MAX_H && bottom - p.h >= FACE_LINE))
  const { p, scale, fits } = pick.chosen
  const top = bottom - p.h

  // 文字の後ろだけを、境目のないグラデーションで暗くする（見やすさ4.5以上。灰色の帯に見せない）
  const shade = shadeBehind(ctx, top, bottom)

  // ロゴは表紙と最後の1枚だけ（猫カードには入れない。11/6 作者の決定）
  const t = drawText(ctx, p, SAFE.left, top, WHITE, 'left', true)

  return {
    design: 'A',
    fits: fits && t.widest <= w + 0.5 && top >= FACE_LINE && t.bottom <= bottom + 1 && shade.contrast >= 4.5,
    scale,
    ...wordInfo(pick, p, lines),
    contrast: round1(shade.contrast),
    darken: round1(shade.darken * 100) / 100,
    framing: used,
  }
}

const wordInfo = (pick: WordPick, p: Planned, lines: string[]) => ({
  linesShown: p.body.length,
  linesTotal: lines.length,
  word: pick.words[0] ?? null,
  wordIndex: pick.indexes[0] ?? -1,
  words: pick.words,
  wordIndexes: pick.indexes,
  wordRows: p.body[0]?.length ?? 0,
  skippedLong: pick.skippedLong,
  skippedSame: pick.skippedSame,
  longLines: pick.longLines,
})

// 帯の色と文字の色を決める
// 帯を描く（SPEC 3.1）。柄の画像（白黒）があれば画面いっぱいに敷き、テーマ色を乗算で重ねる。なければテーマ色の無地
// 写真・動画はこのあと上に置くので、すき間が帯になる
export function paintBand(ctx: CanvasRenderingContext2D, band: string, pattern: Img | null | undefined) {
  ctx.fillStyle = band
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  if (!pattern || !pattern.width || !pattern.height) return
  ctx.save()
  const s = Math.max(CARD_W / pattern.width, CARD_H / pattern.height)
  ctx.drawImage(pattern, (CARD_W - pattern.width * s) / 2, (CARD_H - pattern.height * s) / 2, pattern.width * s, pattern.height * s)
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = band
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  ctx.restore()
}
// 柄の上に文字を置くときだけ、文字の後ろの明るさ（または暗さ）を測り、読める濃さ（見やすさ4.5以上）まで、
// 白い文字なら暗く、濃い文字なら明るく、文字の後ろだけを重ねる（無地のときは帯の色ですでに4.5以上）
export function readableOnBand(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, textColor: string) {
  const X = Math.max(0, Math.floor(x))
  const Y = Math.max(0, Math.floor(y))
  const W = Math.min(CARD_W - X, Math.ceil(w))
  const H = Math.min(CARD_H - Y, Math.ceil(h))
  if (W <= 0 || H <= 0) return
  let d: Uint8ClampedArray
  try {
    d = ctx.getImageData(X, Y, W, H).data
  } catch {
    return
  }
  const lums: number[] = []
  for (let i = 0; i < d.length; i += 4 * 7) lums.push(lum(d[i], d[i + 1], d[i + 2]))
  lums.sort((a, b) => a - b)
  const white = textColor === WHITE
  const worst = white ? lums[Math.floor(lums.length * 0.9)] ?? 0 : lums[Math.floor(lums.length * 0.1)] ?? 1
  const textLum = white ? 1 : hexLum(textColor)
  let a = 0
  const after = (k: number) => (white ? worst * (1 - k) : worst + (1 - worst) * k)
  while (a < 0.9 && ratio(textLum, after(a)) < 4.5) a = Math.min(0.9, a + 0.05)
  if (a <= 0) return
  const pad = 24
  ctx.fillStyle = white ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`
  ctx.fillRect(X - pad, Y - pad, W + pad * 2, H + pad * 2)
}

// 帯の文字はいつも白。明るいテーマ色でも、白い文字が読める（見やすさ4.5以上）濃さまで帯の色を暗くする（11/6夜 作者の決定）。
// テーマ色の設定は変えない（帯の色だけ）
export function bandColors(theme: string): { band: string; color: string; contrast: number } {
  // 黄色の仲間は、画面の文字と同じく、からし色の方向へ濃くする（緑っぽく見えないように。11/7 作者の決定）
  const y = yellowInk(theme, '#ffffff')
  if (y) {
    const [yr, yg, yb] = [1, 3, 5].map((i) => parseInt(y.slice(i, i + 2), 16))
    return { band: y, color: WHITE, contrast: ratio(1, lum(yr, yg, yb)) }
  }
  const n = parseInt(theme.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  let t = 0
  let c = rgb
  while (ratio(1, lum(c[0], c[1], c[2])) < 4.5 && t < 1) {
    t = Math.min(1, t + 0.02)
    c = rgb.map((v) => Math.round(v * (1 - t)))
  }
  const hex = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
  return { band: hex, color: WHITE, contrast: ratio(1, lum(c[0], c[1], c[2])) }
}

// 縦の写真の上の白い文字：文字の後ろだけを、境目のないグラデーションで暗くする（灰色の帯に見せない。11/6夜 作者の決定）
// 暗くする強さは、文字の後ろの明るい所でも見やすさ4.5以上になるまで（最低0.3、最大0.85）
function paintShade(ctx: CanvasRenderingContext2D, top: number, bottom: number, darken: number) {
  const y0 = Math.max(0, top - 200) // 文字の上は短く（顔にかかりにくいように）⚙
  const y1 = Math.min(CARD_H, bottom + 240)
  const span = Math.max(1, y1 - y0)
  const a = (top - y0) / span
  const z = (bottom - y0) / span
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  const N = 8
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const e = t * t * (3 - 2 * t) // なめらかに（始まりと終わりに、つなぎ目が見えないように）
    g.addColorStop(a * t, `rgba(0,0,0,${(darken * e).toFixed(3)})`)
  }
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const e = t * t * (3 - 2 * t)
    g.addColorStop(z + (1 - z) * t, `rgba(0,0,0,${(darken * (1 - e)).toFixed(3)})`)
  }
  ctx.fillStyle = g
  ctx.fillRect(0, y0, CARD_W, y1 - y0)
}
function shadeBehind(ctx: CanvasRenderingContext2D, top: number, bottom: number): { darken: number; contrast: number } {
  const [r, g, b] = brightLums(ctx, SAFE.left, top, WIDE_W, bottom - top)
  let darken = 0.3
  const after = (a: number) => lum(r * (1 - a), g * (1 - a), b * (1 - a))
  while (darken < 0.85 && ratio(1, after(darken)) < 4.5) darken = Math.min(0.85, darken + 0.05)
  paintShade(ctx, top, bottom, darken)
  return { darken, contrast: ratio(1, after(darken)) }
}
// 縦の写真で、文字（と、そのすぐ後ろの暗い所）をここより下に置く。猫の顔は写真の上のほうにあると見る ⚙
// （Claudeは写真を見ない。顔がずれるときは、人が指で写真を動かす）
const FACE_LINE = 800

// 案B：上下にテーマ色の帯。上の帯に大きな文字（名前・年齢と性別・カードの言葉）。写真は切らずに、帯のあいだに
const B_PAD = 36 // 帯の中の、文字の上下の余白
const B_MIN_PHOTO = 700 // 写真に残す高さの下限 ⚙
// カードの言葉がふつうの写真の高さでは入らないときだけ、写真をここまで小さくしてよい（できるだけ言葉を載せるため。#10）⚙
const B_MIN_PHOTO_TWO = 560

function drawB(ctx: CanvasRenderingContext2D, opts: Opts, lines: string[]): CardLayout {
  // 帯の文字はいつも白。帯の色を、白が読める濃さまで暗くする（11/6夜 作者の決定）
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
  const pick = pickWords(lines, opts.avoid, (ls) => {
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

  paintBand(ctx, band, opts.pattern)
  if (opts.photo) drawContain(ctx, opts.photo, 0, topH, CARD_W, CARD_H - topH - botH)
  if (opts.pattern) readableOnBand(ctx, SAFE.left, SAFE.top, WIDE_W, p.h, color)

  // ロゴは表紙と最後の1枚だけ（猫カードには入れない。11/6 作者の決定）
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

// ── 表紙（SPEC 3.2 の1番目）：写真1枚目・「ずっとのおうちを探しています」・「○○です」・その下にロゴか団体名（11/6 クローバーをやめた） ──
// 言葉は決まった文で、入力にない事実を足さない（11/5夜 作者の決定）。名前は猫カードと同じく下のほう（11/5 作者の決定）
export const COVER_GREETING = 'ずっとのおうちを探しています'
export type CoverLayout = { design: CardDesign; fits: boolean; contrast: number; nameSize: number; mark: 'logo' | 'org' | 'none'; markBottom: number; framing: Framing | null }
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
  opts: { photo: Img | null; logo: Img | null; name: string; theme: string; shelterName?: string; pattern?: Img | null; framing?: Framing },
): CoverLayout {
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  const design = designFor(opts.photo)
  const title = opts.name.trim() ? `${opts.name.trim()}です` : ''
  const org = (opts.shelterName ?? '').trim()
  if (design === 'B') {
    // 横・正方形の写真：上の帯に、言葉・名前・その下に差出人のようにロゴか団体名（11/6 作者の決定）。下の帯には何も置かない
    const { band, color, contrast } = bandColors(opts.theme)
    const gSize = planGreeting(ctx, 0.9, WIDE_W)
    const { size, lines } = planName(ctx, title, 1.0, WIDE_W)
    const textTop = SAFE.top
    const nameTop = textTop + gSize * 1.2 + GREET_GAP
    const markTop = nameTop + lines.length * size * NAME_LH + MARK_GAP
    const mark = planMark(ctx, opts.logo, org, CARD_H - SAFE.bottom - markTop - B_PAD - B_MIN_PHOTO_TWO, opts.theme)
    const topH = markTop + mark.h + (mark.h ? B_PAD : B_PAD - MARK_GAP)
    const botH = SAFE.bottom
    paintBand(ctx, band, opts.pattern)
    if (opts.photo) drawContain(ctx, opts.photo, 0, topH, CARD_W, CARD_H - topH - botH)
    if (opts.pattern) readableOnBand(ctx, SAFE.left, textTop, WIDE_W, markTop + mark.h - textTop, color)
    const gw = drawGreeting(ctx, gSize, textTop, color, false)
    const p: Planned = { nameLines: lines, prof: [], profSize: 0, body: [], nameSize: size, lineSize: 0, h: 0 }
    const n = drawText(ctx, p, CARD_W / 2, nameTop, color, 'center', false, 'name')
    const mw = drawMark(ctx, mark, markTop, color, false)
    return {
      design,
      fits: gw <= WIDE_W + 0.5 && n.widest <= WIDE_W + 0.5 && mw <= WIDE_W + 0.5 && markTop + mark.h <= topH && topH <= CORNER_TOP,
      contrast: round1(contrast),
      nameSize: size,
      mark: mark.kind,
      markBottom: Math.round(markTop + mark.h),
      framing: null, // 横・正方形の写真は、帯のあいだに切らずに入れるので動かさない
    }
  }

  // 縦の写真：写真を全面に。言葉と名前は白い文字（影つき）。その下に差出人のようにロゴか団体名（11/6 作者の決定）
  ctx.fillStyle = '#6b5f55'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  // 縦の写真は、指で動かした位置で（11/8。猫カードと同じ形。動かしていなければ真ん中）
  const used = opts.photo ? drawFramed(ctx, opts.photo, 0, 0, CARD_W, CARD_H, 0.5, opts.framing ?? NO_FRAMING) : null
  const gSize = planGreeting(ctx, 1, WIDE_W)
  const { size, lines } = planName(ctx, title, 1.1, WIDE_W)
  const nameH = lines.length * size * NAME_LH
  const h = gSize * 1.2 + GREET_GAP + nameH // 言葉＋名前のかたまり
  // 言葉と名前は、ロゴがないときと同じ位置（ロゴのために上げない。11/6 作者の決定）。真ん中にそろえるので、右下のボタンの高さ（下から540）より上
  const top = CORNER_TOP - 10 - h
  const markTop = top + h + MARK_GAP
  // ロゴか団体名は名前の下。下の隠れる所（下300）には入れない（入らないときはロゴを小さくする）
  const mark = planMark(ctx, opts.logo, org, CARD_H - SAFE.bottom - markTop, opts.theme)
  const bottom = markTop + mark.h
  // 言葉・名前・ロゴか団体名の後ろだけを、境目のないグラデーションで暗くする（ほかのカードと同じ。11/6夜）
  const shade = shadeBehind(ctx, top, bottom)
  const gw = drawGreeting(ctx, gSize, top, WHITE, true)
  const p: Planned = { nameLines: lines, prof: [], profSize: 0, body: [], nameSize: size, lineSize: 0, h: nameH }
  const n = drawText(ctx, p, CARD_W / 2, top + gSize * 1.2 + GREET_GAP, WHITE, 'center', true, 'name')
  const mw = drawMark(ctx, mark, markTop, WHITE, true)
  const w = widthFor(n.bottom)
  return {
    design,
    fits: gw <= WIDE_W + 0.5 && n.widest <= w + 0.5 && mw <= WIDE_W + 0.5 && top >= SAFE.top && bottom <= CARD_H - SAFE.bottom,
    contrast: round1(shade.contrast),
    nameSize: size,
    mark: mark.kind,
    markBottom: Math.round(bottom),
    framing: used,
  }
}

// 表紙の、名前の下のロゴか団体名（差出人のように）。11/6 作者の決定
// ロゴ：直径220pxの丸いアイコン（真ん中を丸く切り抜く。11/7 作る人の決定。src/lib/logo.ts）
// 団体名：言葉と同じ60px（遠くから読めるように）。長いときは2行・小さくする
const MARK_LOGO = 220
const MARK_GAP = 22
const ORG_PX = 60
type Mark = { kind: 'logo' | 'org' | 'none'; h: number; logo?: Img; w?: number; lines?: string[]; size?: number; theme?: string }
function planMark(ctx: CanvasRenderingContext2D, logo: Img | null, org: string, room: number, theme: string): Mark {
  if (logo && logo.width > 0 && logo.height > 0) {
    const d = Math.round(room > 40 ? Math.min(MARK_LOGO, room) : MARK_LOGO) // 隠れる所に入らないように小さくする
    return { kind: 'logo', h: d, w: d, logo, theme }
  }
  if (org) {
    for (const s of [1, 0.9, 0.8, 0.7]) {
      const size = Math.round(ORG_PX * s)
      ctx.font = `800 ${size}px ${FONT}`
      const lines = wrapName(ctx, org, WIDE_W)
      if (lines.length <= 2 || s === 0.7) return { kind: 'org', h: Math.round(lines.length * size * 1.3), lines: lines.slice(0, 2), size }
    }
  }
  return { kind: 'none', h: 0 }
}
function drawMark(ctx: CanvasRenderingContext2D, m: Mark, y: number, color: string, shadow: boolean): number {
  if (m.kind === 'logo' && m.logo && m.w) {
    drawLogoCircle(ctx, m.logo, CARD_W / 2 - m.w / 2, y, m.w, m.theme ?? '#888888')
    return m.w
  }
  if (m.kind === 'org' && m.lines && m.size) {
    ctx.save()
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = 16
      ctx.shadowOffsetY = 3
    }
    ctx.font = `800 ${m.size}px ${FONT}`
    let widest = 0
    m.lines.forEach((l, i) => {
      ctx.fillText(l, CARD_W / 2, y + i * m.size! * 1.3)
      widest = Math.max(widest, ctx.measureText(l).width)
    })
    ctx.restore()
    return widest
  }
  return 0
}

// 最後の1枚の譲渡会の日時（描くのは drawEndCard。下のほう）
export type EndEvent = { date: string; startTime: string; endTime: string; venue: string }
export type EndLayout = {
  design: CardDesign
  fits: boolean
  scale: number
  hasEvent: boolean
  contrast: number
  framing: Framing | null
  textTop: number
  textBottom: number
  contactPx: number // 連絡先の文字の大きさ（1080の中で。CONTACT_MIN_PX より小さくしない）
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
export function eventDateText(e: EndEvent): string {
  const [y, m, d] = e.date.split('-').map(Number)
  if (!y || !m || !d) return e.date
  return `${m}月${d}日（${WEEK[new Date(y, m - 1, d).getDay()]}）`
}
export const eventTimeText = (e: EndEvent) => (e.startTime ? `${e.startTime}〜${e.endTime}` : '')


// ── 撮った動画に重ねる名前（SPEC 3.2 の2番目）──
// 表紙と同じ置き方（下。右下のボタンの高さより上、真ん中にそろえる）で、少し小さく（11/5 作る人の決定）
// area：横・正方形の動画を帯つきで置いたときの、映像の上下（縦の動画は画面いっぱいなので null）
// 横の動画では、名前が映像の下の端をまたぐと切れて見えるので、表紙の案Bと同じく映像の上の帯に置く（11/6 作者が見本で気づいた）。
// 上の帯に入らないとき（正方形に近い動画）は、映像の中の下のほうに収める
// bandText：帯の上に置くときの文字の色（いつも白。11/6夜）。pattern：帯に柄があるか（あれば文字の後ろを読める濃さに）
// profile：名前の下の、年齢と性別の1行（猫カードと同じ「推定2歳・男の子」。不明な項目は入れない。両方不明なら空で、出さない。11/6 作者の決定）
const CLIP_PROF_PX = 48
export function drawClipName(
  ctx: CanvasRenderingContext2D,
  name: string,
  area: { top: number; bottom: number } | null = null,
  band: { text: string; pattern: boolean } = { text: WHITE, pattern: false },
  profile = '',
): { top: number; bottom: number } | null {
  if (!name.trim()) return null
  const { size, lines } = planName(ctx, name, 0.8, WIDE_W)
  ctx.font = `600 ${CLIP_PROF_PX}px ${FONT}`
  const prof = profile.trim() ? wrap(ctx, profile.trim(), WIDE_W) : []
  // 高さは、年齢と性別の行まで入れて測る（上の帯に入るかを、この高さで決める）
  const h = nameH({ nameLines: lines, nameSize: size, prof, profSize: CLIP_PROF_PX })
  let top = CORNER_TOP - 10 - h
  let onBand = false // 映像の上の帯（無地）に置くときは、後ろを暗くしない（映像の上の端が暗くならないように）
  if (area) {
    const above = area.top - 28 - h
    onBand = above >= SAFE.top
    top = onBand ? above : Math.min(CORNER_TOP - 10, area.bottom - 28) - h
  }
  const p: Planned = { nameLines: lines, prof, profSize: CLIP_PROF_PX, body: [], nameSize: size, lineSize: 0, h }
  if (onBand) {
    if (band.pattern) readableOnBand(ctx, SAFE.left, top, WIDE_W, h, band.text)
    drawText(ctx, p, CARD_W / 2, top, band.text, 'center', band.text === WHITE, 'name')
    return { top, bottom: top + h }
  }
  // 動画は1こまずつ明るさを測れないので、決めた強さで、ほかのカードと同じ境目のないグラデーション ⚙
  paintShade(ctx, top, top + h, 0.45)
  drawText(ctx, p, CARD_W / 2, top, WHITE, 'center', true, 'name')
  return { top, bottom: top + h }
}

// ── ひとことカード（SPEC 3.2 の4番目。issue #28）──
// 預かりさん・スタッフさんのひとことを、書き換えずにそのまま載せる（「 」で囲むだけ。改行もそのまま）。
// 「預かりさんより」は付けない（スタッフさんの言葉のこともあり、入力にない事実になるため）
// 縦の写真：写真を画面いっぱいに、下のほうに白い文字。横・正方形の写真：上下にテーマ色の帯、上の帯に白い文字（猫カードと同じ形。11/6夜 作者の決定）

// 文に分ける（「。」「！」「？」・改行のところ。文の途中では切らない）。つなげると元の文に戻る
export function splitSentences(text: string): string[] {
  return text.match(/[^。！？!?\n]*(?:[。！？!?]+[」』）)]*|\n|$)/g)?.filter((s) => s !== '') ?? [text]
}

export type Framing = { x: number; y: number; scale: number } // 写真の位置（#29。指で動かした分。scale は1以上）
const NO_FRAMING: Framing = { x: 0, y: 0, scale: 1 }
// 縦の写真のときの、ひとこと・最後の1枚の文字の下の端（下300の隠れる所より上）
const LOW_BOTTOM = CARD_H - SAFE.bottom - 40

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

// 縦の写真は画面いっぱいに（指で動かせる）、横・正方形の写真は帯のあいだに切らずに入れる。写真がないときは無地の濃い色
function paintPhoto(ctx: CanvasRenderingContext2D, design: CardDesign, photo: Img | null, framing: Framing, topH: number): Framing | null {
  if (design === 'B') {
    if (photo) drawContain(ctx, photo, 0, topH, CARD_W, CARD_H - topH - SAFE.bottom)
    return null
  }
  ctx.fillStyle = '#6b5f55'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  return photo ? drawFramed(ctx, photo, 0, 0, CARD_W, CARD_H, 0.5, framing) : null
}

// 文字の行（帯の上なら真ん中にそろえ、写真の上なら左にそろえて影を付ける）
type TextRow = { lines: string[]; px: number; weight: number; lh: number; gap: number; alpha?: number; logo?: { img: Img; w: number; h: number; theme: string } }
const rowsH = (rows: TextRow[]) => rows.reduce((y, r) => y + r.gap + (r.logo ? r.logo.h : r.lines.length * r.px * r.lh), 0)
function drawRows(ctx: CanvasRenderingContext2D, rows: TextRow[], top: number, design: CardDesign, color: string): { widest: number; bottom: number } {
  const center = design === 'B'
  const x = center ? CARD_W / 2 : SAFE.left
  ctx.save()
  ctx.textBaseline = 'top'
  ctx.textAlign = center ? 'center' : 'left'
  ctx.fillStyle = color
  if (!center) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 16
    ctx.shadowOffsetY = 3
  }
  let y = top
  let widest = 0
  for (const r of rows) {
    y += r.gap
    if (r.logo) {
      // ロゴは丸いアイコン（台を足さない。透明なロゴはテーマ色の丸の上。src/lib/logo.ts）。影は付けない
      ctx.save()
      ctx.shadowColor = 'transparent'
      drawLogoCircle(ctx, r.logo.img, center ? CARD_W / 2 - r.logo.w / 2 : SAFE.left, y, r.logo.w, r.logo.theme)
      ctx.restore()
      widest = Math.max(widest, r.logo.w)
      y += r.logo.h
      continue
    }
    ctx.font = `${r.weight} ${Math.round(r.px)}px ${FONT}`
    ctx.globalAlpha = r.alpha ?? 1
    for (const l of r.lines) {
      ctx.fillText(l, x, y + r.px * 0.08)
      widest = Math.max(widest, ctx.measureText(l).width)
      y += r.px * r.lh
    }
    ctx.globalAlpha = 1
  }
  ctx.restore()
  return { widest, bottom: y }
}

// 文字のかたまりの置き場所。帯：上の帯（写真を B_MIN_PHOTO_TWO 以上残し、右下のボタンの高さより上）。
// 縦の写真：下のほう（顔にかからない FACE_LINE より下）
function placeRows(design: CardDesign, h: number): { top: number; topH: number; ok: boolean } {
  if (design === 'B') {
    const topH = SAFE.top + h + B_PAD
    return { top: SAFE.top, topH, ok: topH - B_PAD <= CORNER_TOP && CARD_H - topH - SAFE.bottom >= B_MIN_PHOTO_TWO }
  }
  const top = LOW_BOTTOM - h
  return { top, topH: 0, ok: top >= FACE_LINE }
}

// 描く。帯なら帯と写真と文字、縦の写真なら写真と、文字の後ろの暗さと文字
function paintRows(
  ctx: CanvasRenderingContext2D,
  design: CardDesign,
  rows: TextRow[],
  opts: { theme: string; photo?: Img | null; framing?: Framing; pattern?: Img | null },
): { framing: Framing | null; contrast: number; top: number; bottom: number; widest: number; ok: boolean } {
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  const h = rowsH(rows)
  const pl = placeRows(design, h)
  if (design === 'B') {
    const { band, color, contrast } = bandColors(opts.theme)
    paintBand(ctx, band, opts.pattern)
    paintPhoto(ctx, design, opts.photo ?? null, NO_FRAMING, pl.topH)
    if (opts.pattern) readableOnBand(ctx, SAFE.left, pl.top, WIDE_W, h, color)
    const t = drawRows(ctx, rows, pl.top, design, color)
    return { framing: null, contrast, top: pl.top, bottom: t.bottom, widest: t.widest, ok: pl.ok && t.widest <= WIDE_W + 0.5 }
  }
  const used = paintPhoto(ctx, design, opts.photo ?? null, opts.framing ?? NO_FRAMING, 0)
  const shade = shadeBehind(ctx, pl.top, pl.top + h)
  const t = drawRows(ctx, rows, pl.top, design, WHITE)
  return { framing: used, contrast: shade.contrast, top: pl.top, bottom: t.bottom, widest: t.widest, ok: pl.ok && t.widest <= NARROW_W + 0.5 && shade.contrast >= 4.5 }
}

const WORDS_SIZES = [46, 44, 42] // ひとことの文字の大きさ（通常46px、長いときは42pxまで。作る人の決定）
const WORDS_LH = 1.6
export const WORDS_MAX_ROWS = 4 // ひとことは4行まで（11/6夜 作者の決定）
// 縦・横・正方形のどれでも同じ幅で折る（写真によって入る・入らないが変わらないように）。右下のボタンの線（右180）より左
const WORDS_W = NARROW_W
// 秒数：2秒＋行数（1行3秒〜4行6秒。猫カードの言葉と同じ数え方。11/6夜 作者の決定）
export const wordsSecFor = (rows: number) => Math.min(6, Math.max(3, 2 + rows))

export type WordsLayout = { design: CardDesign; fits: boolean; scale: number; sec: number; size: number; lines: number; contrast: number; framing: Framing | null; textTop: number; textBottom: number }

export function drawWordsCard(
  ctx: CanvasRenderingContext2D,
  opts: { text: string; theme: string; photo?: Img | null; framing?: Framing; pattern?: Img | null },
): WordsLayout {
  const design = designFor(opts.photo ?? null)
  const quoted = `「${opts.text.trim()}」`
  let size = WORDS_SIZES[0]
  let lines: string[] = []
  for (const px of WORDS_SIZES) {
    size = px
    ctx.font = `700 ${px}px ${FONT}`
    lines = quoted.split('\n').flatMap((para) => (para ? wrap(ctx, para, WORDS_W) : ['']))
    if (lines.length <= WORDS_MAX_ROWS) break
  }
  const rows: TextRow[] = [
    { lines: ['ひとこと'], px: 40, weight: 800, lh: 1.3, gap: 0, alpha: 0.9 },
    // 入りきらないときは、カードには使わない（画面で知らせる。行の途中で切らない）。ここでは入る分だけ描く
    { lines: lines.slice(0, WORDS_MAX_ROWS), px: size, weight: 700, lh: WORDS_LH, gap: 14 },
  ]
  const r = paintRows(ctx, design, rows, opts)
  return {
    design,
    fits: lines.length <= WORDS_MAX_ROWS && r.ok,
    scale: size / WORDS_SIZES[0],
    sec: wordsSecFor(Math.min(lines.length, WORDS_MAX_ROWS)),
    size,
    lines: lines.length,
    contrast: round1(r.contrast),
    framing: r.framing,
    textTop: Math.round(r.top),
    textBottom: Math.round(r.bottom),
  }
}

// ── 最後の1枚（SPEC 3.2 の5番目）：次の譲渡会の日時・場所、ロゴ、団体名、連絡先 ──
// ひとことカードと同じ形（縦の写真は写真の上に白い文字、横・正方形は上の帯に白い文字。便箋・切手はなし。11/6夜 作者の決定）
// ロゴは大きめに、白い背景も含めてそのまま。ロゴがなければ団体名を大きく。連絡先はスマホで読める大きさより小さくしない
const CONTACT_MIN_PX = 36 // 連絡先の文字の下限（スマホの画面で約13px）⚙
export function drawEndCard(
  ctx: CanvasRenderingContext2D,
  opts: { logo: Img | null; shelterName: string; contact: string; event: EndEvent | null; theme: string; photo?: Img | null; framing?: Framing; pattern?: Img | null },
): EndLayout {
  const design = designFor(opts.photo ?? null)
  const width = design === 'B' ? WIDE_W : NARROW_W
  const contact = opts.contact
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const logo = opts.logo && opts.logo.width > 0 && opts.logo.height > 0 ? opts.logo : null
  const build = (k: number): TextRow[] => {
    const rows: TextRow[] = []
    const text = (t: string, px: number, weight: number, gap: number, alpha?: number, name = false): TextRow => {
      ctx.font = `${weight} ${Math.round(px)}px ${FONT}`
      return { lines: name ? wrapName(ctx, t, width) : wrap(ctx, t, width), px, weight, lh: 1.3, gap, alpha }
    }
    if (opts.event) {
      rows.push(text('次の譲渡会', 40 * k, 800, 0, 0.9))
      rows.push(text(eventDateText(opts.event), 58 * k, 800, 10 * k))
      const time = eventTimeText(opts.event)
      if (time) rows.push(text(time, 50 * k, 800, 0))
      if (opts.event.venue) rows.push(text(opts.event.venue, 46 * k, 700, 6 * k))
    }
    const g = opts.event ? 40 * k : 0
    if (logo) {
      const d = (opts.event ? 150 : 200) * k // 丸いアイコンの直径
      rows.push({ lines: [], px: 0, weight: 0, lh: 1, gap: g, logo: { img: logo, w: d, h: d, theme: opts.theme } })
    }
    if (opts.shelterName.trim()) rows.push(text(opts.shelterName.trim(), (logo ? 54 : 76) * k, 800, logo ? 16 * k : g, undefined, true))
    contact.forEach((c, i) => rows.push(text(c, Math.max(CONTACT_MIN_PX, 40 * k), 600, (i ? 2 : 12) * k)))
    return rows
  }
  let k = 1
  let rows = build(1)
  for (const s of [1, 0.92, 0.84, 0.76, 0.68]) {
    k = s
    rows = build(s)
    if (placeRows(design, rowsH(rows)).ok) break
  }
  const r = paintRows(ctx, design, rows, opts)
  return {
    design,
    fits: r.ok,
    scale: k,
    hasEvent: !!opts.event,
    contrast: round1(r.contrast),
    framing: r.framing,
    textTop: Math.round(r.top),
    textBottom: Math.round(r.bottom),
    contactPx: contact.length ? Math.round(Math.max(CONTACT_MIN_PX, 40 * k)) : 0,
  }
}
