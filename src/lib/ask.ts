// 聞き返し（#18。SPEC 2.3・4.2）の、画面とサーバー側の両方で使う決まり
// - 質問は、預かりさんへ送るLINEの文の形で出す。初めに入る文は SPEC 2.3 のとおり（送る前に、欄の中で自由に直せる）
// - 貼った返事は書き換えずに、元のメモの最後に「（預かりさんの返事）」として足す。その前に、聞いた質問（送ったLINEの文）も「（預かりさんへの質問）」として足す（11/7 作者の決定）
// - 質問の形はプログラムでも確かめる（1つだけ・「？」で終わる・改行なし・長すぎない）

export const REPLY_LABEL = '（預かりさんの返事）'
export const QUESTION_LABEL = '（預かりさんへの質問）'
export const QUESTION_MAX = 60 // 質問の長さの上限（字）⚙

// 預かりさんへ送るLINEの文（名前がまだないときは「紹介を書いています。」から ⚙）
export function askLine(name: string, question: string): string {
  const n = name.trim()
  return `${n ? `${n}ちゃんの` : ''}紹介を書いています。${question.trim()} よかったら教えてください。`
}

// 質問の形：1文で、最後だけに「？」（または ?）、改行なし、3〜60字
export function questionOk(q: string): boolean {
  const t = q.trim()
  if (t.length < 3 || [...t].length > QUESTION_MAX) return false
  if (/[\r\n]/.test(t)) return false
  const marks = (t.match(/[？?]/g) ?? []).length
  return marks === 1 && /[？?]$/.test(t)
}

// 返事をメモの最後に足すときの形（返事も、送ったLINEの文も、一字も変えない）
// 質問は、Claudeが作った質問ではなく、スタッフさんが直して送ったLINEの文をそのまま足す（預かりさんが実際に読んだ文なので）
export const replyAddition = (reply: string, line = '') =>
  line.trim() ? `${QUESTION_LABEL}\n${line.trim()}\n${REPLY_LABEL}\n${reply}` : `${REPLY_LABEL}\n${reply}`

// 読み取り・投稿文づくりに使うメモ（元のメモ＋足した返事）。どこでも同じつなぎ方にする
export function fullMemo(c: { memo: string; memoAdditions: string }): string {
  return c.memo + (c.memoAdditions.trim() ? `\n${c.memoAdditions}` : '')
}
