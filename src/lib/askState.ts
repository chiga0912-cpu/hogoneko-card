// 聞き返し（#18）の下書きの残し方。返事を待つ間も残す（SPEC 2.3）

export type AskState = {
  memo: string // どのメモに対する聞き返しか（メモが変わったら使わない）
  line: string // 預かりさんへ送るLINEの文（直した文）
  reply: string // 使わない（前の版の名残。返事はメモの欄に貼る）
  noted?: string // メモの欄に足した「聞いたこと」の1行（LINEの文を直してコピーし直したら、置きかえる）
  status: 'open' | 'added' | 'skipped' | 'none' // none：聞き返しは要らなかった・出さなかった（同じメモで二度聞かない）
}

// 入力の途中の猫のデータ（Cat）の形は変えずに、このスマホの中にだけ残す（11/7。データに入れるかは作者に聞く）
const ASK_KEY = 'hogoneko-ask'
export function loadAsk(memo: string): AskState | null {
  try {
    const raw = localStorage.getItem(ASK_KEY)
    if (!raw) return null
    const a = JSON.parse(raw) as Partial<AskState>
    if (typeof a.memo !== 'string' || a.memo !== memo || typeof a.line !== 'string' || typeof a.reply !== 'string') return null
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
