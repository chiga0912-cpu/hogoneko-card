// 聞き返し（#18）の下書きの残し方。返事を待つ間も残す（SPEC 2.3）

export type AskState = {
  memo: string // どのメモに対する聞き返しか（メモが変わったら使わない）
  catId?: string // どの子の聞き返しか（メモが同じ別の子に出さない。見直しの中2。前の版の下書きにはない）
  line: string // 預かりさんへ送るLINEの文（直した文）
  reply: string // 使わない（前の版の名残。返事はメモの欄に貼る）
  copied?: boolean // ［LINEの文をコピー］を押した（コピーの後の案内を出す）
  status: 'open' | 'added' | 'skipped' | 'none' // none：聞き返しは要らなかった・出さなかった（同じメモで二度聞かない）
}

// 入力の途中の猫のデータ（Cat）の形は変えずに、このスマホの中にだけ残す（11/7。データに入れるかは作者に聞く）
const ASK_KEY = 'hogoneko-ask'
export function loadAsk(memo: string, catId: string): AskState | null {
  try {
    const raw = localStorage.getItem(ASK_KEY)
    if (!raw) return null
    const a = JSON.parse(raw) as Partial<AskState>
    if (typeof a.memo !== 'string' || a.memo !== memo || a.catId !== catId || typeof a.line !== 'string' || typeof a.reply !== 'string') return null
    if (a.status !== 'open' && a.status !== 'added' && a.status !== 'skipped' && a.status !== 'none') return null
    return a as AskState
  } catch {
    return null
  }
}
export function saveAsk(a: AskState | null) {
  try {
    if (a) localStorage.setItem(ASK_KEY, JSON.stringify(a))
    else localStorage.removeItem(ASK_KEY)
  } catch {
    // 残せないとき（プライベートなど）は、開いている間だけ
  }
}

// 1匹に1回（11/7 夕方 作者の決定）：［LINEの文をコピー］か［飛ばす］を押した猫を、このスマホの中に覚える。猫のデータの形は変えない
// 質問が出ても、どちらかを押す前にメモを直して欄が閉じたときは、覚えない（もう一度読み取ったときに、また聞ける。11/7 夜 作者の決定）
// 覚えたものが消えて（ブラウザのデータを消した・別のスマホなど）、もう一度聞くことになるのはかまわない（作者の決定）
const ASKED_KEY = 'hogoneko-asked-cats'
const MAX_ASKED = 500
const readAsked = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(ASKED_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export const wasAsked = (catId: string) => readAsked().includes(catId)
export function markAsked(catId: string) {
  try {
    const list = readAsked().filter((x) => x !== catId)
    list.push(catId)
    localStorage.setItem(ASKED_KEY, JSON.stringify(list.slice(-MAX_ASKED)))
  } catch {
    // 残せないとき（プライベートなど）は、覚えない（もう一度聞くことになるだけ）
  }
}
