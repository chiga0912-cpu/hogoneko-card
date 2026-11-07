// 聞き返し（#18。SPEC 2.3・4.2）の、画面とサーバー側の両方で使う決まり
// - 質問は、預かりさんへ送るLINEの文の形で出す。初めに入る文は SPEC 2.3 のとおり（送る前に、欄の中で自由に直せる）
// - ［LINEの文をコピー］を押したら、メモの欄の最後に「（預かりさんに聞いたこと）〜」を1行足す（返事が「はい」だけでも意味が分かるように）。
//   返事は、スタッフさんがメモの欄の最後に貼る（返事の専用の欄は作らない。11/7 作者の決定。朝の決定6を置き換え）
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

// メモに足す「聞いたこと」の1行。送ったLINEの文から、初めに入れたあいさつ（「○○ちゃんの紹介を書いています。」「よかったら教えてください。」）を外し、
// 改行は空白にして1行にする。スタッフさんが質問を直していれば、直した質問になる（預かりさんが実際に読んだ質問なので ⚙）
export function askedLine(line: string): string {
  let q = line.trim().replace(/^[^。\n]*紹介を書いています。\s*/, '').replace(/\s*よかったら教えてください。?\s*$/, '')
  q = q.replace(/\s+/g, ' ').trim()
  if (!q) q = line.replace(/\s+/g, ' ').trim()
  return `${ASKED_LABEL}${q}`
}

// メモの欄の最後に「聞いたこと」の1行を足したメモ。前に足した1行（prev）がそのまま残っていれば、置きかえる（同じ子で二重に足さない）
export function noteAsked(memo: string, add: string, prev?: string): string {
  if (memo.split('\n').some((l) => l.trim() === add)) return memo
  if (prev) {
    const lines = memo.split('\n')
    const i = lines.findIndex((l) => l.trim() === prev)
    if (i >= 0) {
      lines[i] = add
      return lines.join('\n')
    }
  }
  return memo.replace(/\s+$/, '') + '\n' + add
}

// このメモで、もう聞いたか（「聞いたこと」の行がある）。あれば、読み取り直しても聞き返さない
export const alreadyAsked = (memo: string) => memo.includes(ASKED_LABEL)

// 読み取り・投稿文づくりに使うメモ。memoAdditions は前の版（返事の専用の欄）の名残で、読み込むときにメモへ移すので、ふだんは空
export function fullMemo(c: { memo: string; memoAdditions: string }): string {
  return c.memo + (c.memoAdditions.trim() ? `\n${c.memoAdditions}` : '')
}
