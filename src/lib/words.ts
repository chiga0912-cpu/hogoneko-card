// カードの言葉の案（#19。SPEC 2.4）の、画面とサーバー側の両方で使う決まり
// - 案は短く（24字まで）。元の行より短い。1行で、改行・絵文字・「！」・最後の「。」なし
// - 人が選んだときだけ使う。使うときは、猫カードの言葉だけを案にする（「いいところ」の行は書き換えない。11/7 作者の決定）

export const MAX_LINES = 5 // 一度に案を作る行の数の上限 ⚙
export const PROPOSAL_MAX = 24 // 案の長さの上限（字）⚙

export function proposalOk(p: string, line: string): boolean {
  const t = p.trim()
  if (!t || [...t].length > PROPOSAL_MAX) return false
  if ([...t].length >= [...line.trim()].length) return false
  if (/[\r\n]/.test(t) || /[！!]/.test(t) || /。$/.test(t)) return false
  if (/\p{Extended_Pictographic}/u.test(t)) return false
  return true
}

// 選んだ案は、名簿の「いいところ」とは別に、猫のデータの cardLines に残す（11/7 作者の決定。「いいところ」の行は書き換えない）
// cardLines の1つは「元の行」と「選んだ案」を改行でつないだもの（「いいところ」は1行に1つなので、行の中に改行はない）。
// 元の行が「いいところ」からなくなったら（手で直した・消した）、その案は使わない（古い案が別の行に付かないように、行の位置ではなく文字で合わせる）
export type CardSwap = { from: string; to: string }
const SEP = '\n'
export function cardSwaps(cardLines: string[], goodPoints: string[]): CardSwap[] {
  const have = new Set(goodPoints.map((g) => g.trim()).filter(Boolean))
  const out: CardSwap[] = []
  for (const x of cardLines) {
    const i = x.indexOf(SEP)
    if (i < 0) continue
    const from = x.slice(0, i).trim()
    const to = x.slice(i + 1).trim()
    if (from && to && have.has(from) && !out.some((s) => s.from === from)) out.push({ from, to })
  }
  return out
}
// 猫カードの言葉の候補：「いいところ」の行の順のまま、案を選んだ行だけを案にする
export function cardWordLines(goodPoints: string[], cardLines: string[]): string[] {
  const swaps = cardSwaps(cardLines, goodPoints)
  return goodPoints.map((g) => swaps.find((s) => s.from === g.trim())?.to ?? g)
}
export const addSwap = (cardLines: string[], from: string, to: string): string[] => [...removeSwap(cardLines, from), `${from.trim()}${SEP}${to.trim()}`]
export const removeSwap = (cardLines: string[], from: string): string[] => cardLines.filter((x) => x.split(SEP)[0].trim() !== from.trim())
