// 聞き返し（#18。SPEC 2.3・4.2）の、画面とサーバー側の両方で使う決まり
// - 質問は、預かりさんへ送るLINEの文の形で出す。初めに入る文は SPEC 2.3 のとおり（送る前に、欄の中で自由に直せる）
// - ［LINEの文をコピー］を押しても、メモの欄には何も足さない。返事は、スタッフさんがメモの欄に貼る（返事の専用の欄は作らない）
//   質問は「はい・いいえ」で答える形にせず、様子を教えてもらう形にする（返事だけで意味が分かるように。11/7 夕方 作者の決定。昼の「聞いたこと」の行を足す形は置き換え）
// - 1匹に1回：聞いた猫を、このスマホの中に覚える（src/lib/askState.ts。猫のデータの形は変えない）
// - 質問の形はプログラムでも確かめる（1つだけ・「？」で終わる・改行なし・長すぎない）

export const ASKED_LABEL = '（預かりさんに聞いたこと）'
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

// このメモで、もう聞いたか。試し用の前の版（11/7）でメモに足した「聞いたこと」「質問」「返事」の行があれば、もう聞いたとみなす（見直しの軽い3）
// 今の版では行を足さないので、聞いたかどうかは askState の wasAsked で見る
export const alreadyAsked = (memo: string) => [ASKED_LABEL, '（預かりさんへの質問）', '（預かりさんの返事）'].some((l) => memo.includes(l))

// 読み取り・投稿文づくりに使うメモ。memoAdditions は前の版（返事の専用の欄）の名残で、読み込むときにメモへ移すので、ふだんは空
export function fullMemo(c: { memo: string; memoAdditions: string }): string {
  return c.memo + (c.memoAdditions.trim() ? `\n${c.memoAdditions}` : '')
}
