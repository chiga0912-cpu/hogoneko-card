// 投稿文の物語の本文（#16。SPEC 4.1・4.2）の、AIに任せない部分。サーバー（functions/）と画面の両方で使う
// - Claudeに渡す「資料」を作る：メモを1通・1行・1文ごとに区切ったもの（文書0）と、確認した項目（文書1）
// - Claudeの答え（文と引用）を、画面で使う形にそろえる
// - 本文から「#」で始まる言葉を外す（ハッシュタグはプログラムが5つまで付けるため）

export type StoryFacts = {
  name: string
  goodPoints: string[]
}

// 本文のひとかたまり。cites は、どの資料のどの区切りから来たか（#17 の根拠の表示で使う）
export type StoryCite = { doc: 0 | 1; start: number; end: number; text: string }
export type StoryPart = { text: string; cites: StoryCite[] }
export type StoryResult = { body: string; parts: StoryPart[]; memoChunks: string[]; factChunks: string[] }

// メモを区切る：空行・改行で分け、さらに「。！？」の後で分ける。空のかたまりは作らない
// 区切りの番号がそのまま引用の番号になるので、画面でも同じ関数で区切る
export function splitMemo(memo: string): string[] {
  const out: string[] = []
  for (const line of memo.replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim()
    if (!t) continue
    const parts = t.match(/[^。！？!?]+[。！？!?」』）)]*|[。！？!?]+/g) ?? [t]
    for (const p of parts) if (p.trim()) out.push(p.trim())
  }
  return out
}

// 確認した項目を、1つずつの区切りにする（名前と、いいところ1行ずつ）
export function factChunks(f: StoryFacts): string[] {
  const out: string[] = []
  if (f.name.trim()) out.push(`名前：${f.name.trim()}`)
  for (const p of f.goodPoints) if (p.trim()) out.push(`いいところ：${p.trim()}`)
  return out
}

// 本文から「#」「＃」で始まる言葉を外す（AIに任せない。SPEC 4.2）
export function stripHashtags(text: string): string {
  return text.replace(/[#＃][^\s#＃、。,.!！?？]+/g, '').replace(/[ \t　]+\n/g, '\n').replace(/[ \t　]{2,}/g, ' ')
}

// 本文のあとにプログラムが足す、決まった文（SPEC 4.2。11/6 作る人の決定）。4つから猫ごとに選ぶ。同じ猫（同じ id）なら、作り直しても同じ文
// 入るのは入力した名前だけなので、根拠の確認の対象にしない。投稿文の欄で人が別の文に変えたり消したりできる
export const CLOSINGS: ((name: string) => string)[] = [
  (n) => `そんな${n}の、ずっとのおうちを探しています。`,
  (n) => `${n}と家族になってくれる方を探しています🍀`,
  (n) => `${n}に、素敵なご縁がありますように🍀`,
  (n) => `${n}に、温かいおうちが見つかりますように🏠`,
]
const pickIndex = (key: string) => {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return h % CLOSINGS.length
}
export const closingLine = (name: string, key: string) => CLOSINGS[pickIndex(key)](name.trim())
// 本文ではない行（前置き・説明・注記）と、同じ行の2回目を外す（AIに任せない）
// 本文はメモや資料のことを書かないので、「メモ」「資料」「書きます」「元に」などを含む行・かっこだけの行は、本文ではないと見なす
// 資料・メモのことを「元にした・書いた」と説明している行、かっこだけの注記（「（ちょっと怖がりです）」や「メモ帳をかじります。」は外さない。見直しの軽い11）
const META = /(メモ|資料|引用|本文|内容).{0,20}(元に|もとに|基づ|書き|まとめ|つなげ)|(書きます|書きました|まとめます)[。.]?$|^[（(][^）)]*(メモ|資料|引用|本文)[^）)]*[）)]$/
export function dropMeta(body: string): string {
  const seen = new Set<string>()
  return body
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      if (!t) return true
      if (META.test(t)) return false
      const k = t.replace(/\p{Extended_Pictographic}\uFE0F?|[！!。、\s]/gu, '')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 本文の絵文字を整える（SPEC 4.2。11/6 作者の決定。AIに任せない）
// - 決まった文で使う 🍀 🏠 は、本文から外す
// - 同じ絵文字は1本に1回だけ。2回目からは外す
// - 絵文字は、最後の決まった文も含めて、投稿文全体で2つまで（11/7 作者の決定。11/6 の「本文に3つまで」は置き換え）
//   超えたときは本文の後ろから消す。決まった文の絵文字は消さない。決まった文には絵文字が1つ入ることがあるので、
//   Claudeが書いた本文はまず1つまでにする（max の初めの値）。投稿文を組み立てるときに、決まった文と合わせて2つまでにする（post.ts）
export const POST_EMOJI_MAX = 2
export const BODY_EMOJI_MAX = 1
const EMOJI = /\p{Extended_Pictographic}\uFE0F?/gu
export const CLOSING_EMOJI = ['🍀', '🏠']
export const countEmoji = (text: string) => (text.match(EMOJI) ?? []).length
export function tidyEmoji(body: string, max = BODY_EMOJI_MAX): string {
  const seen = new Set<string>()
  return body
    .replace(EMOJI, (e) => {
      const k = e.replace('\uFE0F', '')
      if (CLOSING_EMOJI.includes(k) || seen.has(k) || seen.size >= max) return ''
      seen.add(k)
      return e
    })
    .replace(/[ \t　]+\n/g, '\n')
    .trim()
}

// Claudeが書いてきた、最後のまとめの文（決まった文に似たもの）を外す。決まった文と2回出ないように
// 決まった文に近い形だけ（「兄弟のおうちが見つかり、今はひとりです。」のような本当の文は外さない。見直しの軽い11）
const CLOSING_LIKE = /^(そんな.{1,30}の、?ずっとのおうち|.{1,30}と家族になってくれる方を探して|.{1,30}に、?素敵なご縁がありますように|.{1,30}に、?温かいおうちが見つかりますように)/
export function stripClosing(body: string): string {
  const lines = body.split('\n')
  while (lines.length > 1 && CLOSING_LIKE.test(lines[lines.length - 1].trim())) lines.pop()
  return lines.join('\n').trim()
}

// 投稿文の本文を作る前の、短い確かめ（送ってよいか）
export function storyReady(memo: string, f: StoryFacts): boolean {
  return memo.trim().length > 0 || factChunks(f).length > 1
}

// お手本（#15）：作者が書いて確かめた3本。どれも架空の猫。書き方の見本で、中の猫の話・名前・言葉は使わせない（下の LEAK で確かめる）
export const EXAMPLES = [
  {
    memo: 'ムギ、最初はケージの奥から出てこなかったけど、最近はごはんの音がすると走ってくる。膝には乗らないけど、隣でくっついて寝る。',
    body: 'はじめのころのムギは、ケージの奥から出てきませんでした。それが最近は、ごはんの音がすると走ってくるように！🐾\n膝には乗らないけれど、隣にくっついて眠ります😊',
  },
  {
    memo: 'ハルは譲渡会だとずっと固まってしまう。でも家では、朝になると枕元に来てふみふみする。抱っこは苦手。来週ワクチン2回目。',
    body: 'ハルは、譲渡会だとずっと固まってしまいます💦\nでも家では、朝になると枕元に来て、ふみふみしてくれます😊\n抱っこは苦手です。',
  },
  {
    memo: 'コタ、元気。よく食べる。兄弟とよく遊んでる。',
    body: 'コタは元気で、よく食べる子です☺️\n兄弟ともよく遊んでいます！',
  },
]
// お手本にだけ出てくる名前・言葉。メモと確認した項目にないのに本文に出たら、お手本が混ざったと見なす
export const LEAK = ['ムギ', 'ハル', 'コタ', 'ケージ', 'ごはんの音', '走ってくる', '隣にくっついて', '固まって', '枕元', 'ふみふみ', '兄弟']

export const leakedWords = (body: string, source: string) => LEAK.filter((w) => body.includes(w) && !source.includes(w))

// ── 根拠の確認（#17）の答えを読む ──
// 答えは「番号: ある」「番号: ない（資料にない言葉：…）」の行。引用は、その行を含む text のかたまりに付いてくる
export type Verdict = { i: number; ok: boolean; cites: StoryCite[]; reason: string }
type RawCite = { type: string; document_index?: number; start_block_index?: number; end_block_index?: number; cited_text?: string }
export function parseVerdicts(blocks: { text: string; citations: RawCite[] }[], count: number): Verdict[] {
  const out: Verdict[] = Array.from({ length: count }, (_, i) => ({ i, ok: false, cites: [], reason: '答えがありませんでした' }))
  const said = new Map<number, 'ある' | 'ない'>()
  let cur = -1
  const reasonText = new Map<number, string>()
  const takeReason = (n: number, text: string) => {
    const r = /資料にない言葉[：:]\s*([^）)\n]+)/.exec(text)
    if (n >= 0 && r) reasonText.set(n, r[1].trim())
  }
  for (const b of blocks) {
    // かたまりの中の「番号: ある／ない」を順に読む。番号から次の番号までの文字は、その番号のもの（理由もそこから読む）
    // 「ある・ない」のすぐあとに、ひらがな・漢字が続くときは読まない（「あるとは言えません」を「ある」と読まない。見直しの重い5）。「ある「…」」「ある —」などは読む
    const marks = [...b.text.matchAll(/(\d+)\s*[:：.．]\s*(ある|ない)(?![\p{Script=Hiragana}\p{Script=Han}])/gu)]
    takeReason(cur, marks.length ? b.text.slice(0, marks[0].index) : b.text)
    marks.forEach((m, k) => {
      const n = Number(m[1]) - 1
      if (n < 0 || n >= count) return
      cur = n
      const seg = b.text.slice(m.index, k + 1 < marks.length ? marks[k + 1].index : undefined)
      // 一度「ない」と答えた番号は、あとから「ある」に変えない。「資料にない言葉」が書いてある答えは「ない」（見直しの重い5）
      const v = m[2] === 'ない' || /資料にない言葉/.test(seg) ? 'ない' : 'ある'
      if (said.get(n) !== 'ない') said.set(n, v)
      takeReason(n, seg)
    })
    if (cur < 0) continue
    // 引用は、そのかたまりで最後に出てきた番号に付ける（引用つきのかたまりは、ふつう1つの答えの中にある）
    for (const c of b.citations) {
      if (c.type !== 'content_block_location') continue
      const d = c.document_index === 1 ? 1 : c.document_index === 0 ? 0 : null
      if (d === null || c.start_block_index === undefined || c.end_block_index === undefined) continue
      out[cur].cites.push({ doc: d, start: c.start_block_index, end: c.end_block_index, text: c.cited_text ?? '' })
    }
  }
  for (const v of out) {
    const s = said.get(v.i)
    // 「ある」と答えても、引用がなければ根拠なしとして扱う（AIの答えだけに頼らない）
    v.ok = s === 'ある' && v.cites.length > 0
    v.reason = s === 'ない' ? (reasonText.get(v.i) ?? 'メモに根拠が見つかりませんでした') : s === 'ある' && !v.cites.length ? '根拠の引用がありませんでした' : s ? '' : v.reason
  }
  return out
}

// 本文を、確かめる文に分ける（改行と「。！？」のあと。絵文字や「♪」は前の文に付けたまま）
export function storySentences(body: string): string[] {
  const out: string[] = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const parts = t.match(/[^。！？!?]+(?:[。！？!?]+[^\p{L}\p{N}「]*)?|[。！？!?]+/gu) ?? [t]
    for (const p of parts) if (p.trim()) out.push(p.trim())
  }
  return out
}

// ── 入力の途中に残す、本文と根拠の確認の結果（#17。11/6 作者のOK）──
// 確認が終わったものだけ残す（確かめている途中・失敗は残さない。開き直したら、もう一度確かめる）
export type SavedCheck = { sentences: string[]; verdicts: Verdict[]; kept: number[]; removed?: number[] } // removed：［消す］で消した文
export type StoryDraft = { result: StoryResult; check: SavedCheck | null }
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const cites = (v: unknown): StoryCite[] =>
  Array.isArray(v)
    ? v.filter((c): c is StoryCite => isObj(c) && (c.doc === 0 || c.doc === 1) && typeof c.start === 'number' && typeof c.end === 'number').map((c) => ({ doc: c.doc, start: c.start, end: c.end, text: typeof c.text === 'string' ? c.text : '' }))
    : []
// 読めない形のときは null（入力の途中のほかの部分は、そのまま使う）
export function normalizeStoryDraft(v: unknown): StoryDraft | null {
  if (!isObj(v) || !isObj(v.result)) return null
  const r = v.result
  if (typeof r.body !== 'string' || !strs(r.memoChunks) || !strs(r.factChunks) || !Array.isArray(r.parts)) return null
  const result: StoryResult = {
    body: r.body,
    memoChunks: r.memoChunks,
    factChunks: r.factChunks,
    parts: r.parts.filter(isObj).map((p) => ({ text: typeof p.text === 'string' ? p.text : '', cites: cites(p.cites) })),
  }
  let check: SavedCheck | null = null
  const c = v.check
  if (isObj(c) && strs(c.sentences) && Array.isArray(c.verdicts) && Array.isArray(c.kept)) {
    const verdicts = c.verdicts.filter(isObj).map((x, i) => ({ i: typeof x.i === 'number' ? x.i : i, ok: x.ok === true, cites: cites(x.cites), reason: typeof x.reason === 'string' ? x.reason : '' }))
    // 文の数と答えの数が合わないときは、確認していないことにする（もう一度確かめる）
    if (verdicts.length === c.sentences.length)
      check = {
        sentences: c.sentences,
        verdicts,
        kept: c.kept.filter((k): k is number => typeof k === 'number'),
        removed: Array.isArray(c.removed) ? c.removed.filter((k): k is number => typeof k === 'number') : [],
      }
  }
  return { result, check }
}

// 投稿文から、1つの文を消す（見直しの重い2）
// 本文の部分（「＜ひとこと＞」より上）だけを見て、文に区切ったときにぴったり同じ文だけを消す（ひとことや、その文を含む別の文は変えない）
export function removeSentence(post: string, sentence: string): string {
  const target = sentence.trim()
  let inBody = true
  let removed = false
  const out: string[] = []
  for (const line of post.split('\n')) {
    if (line.startsWith('＜ひとこと＞')) inBody = false
    if (!inBody || removed) {
      out.push(line)
      continue
    }
    const parts = storySentences(line)
    const i = parts.indexOf(target)
    if (i < 0) {
      out.push(line)
      continue
    }
    removed = true
    parts.splice(i, 1)
    if (parts.length) out.push(parts.join(''))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
