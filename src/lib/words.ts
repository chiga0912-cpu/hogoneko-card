// カードの言葉の案（#19。SPEC 2.4）の、画面とサーバー側の両方で使う決まり
// - 案は短く（24字まで）。元の行より短い。1行で、改行・絵文字・「！」・最後の「。」なし
// - 人が選んだときだけ使う。使うときは「いいところ」の行を、選んだ案に置きかえる（ほかの行は変えない）

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

// 「いいところ」の行を、選んだ案に置きかえる（同じ行が2つあれば、初めの1つだけ）
export function replaceLine(lines: string[], from: string, to: string): string[] {
  const i = lines.findIndex((l) => l.trim() === from.trim())
  if (i < 0) return lines
  const next = [...lines]
  next[i] = to.trim()
  return next
}
