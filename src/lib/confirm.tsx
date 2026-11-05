// 確認の知らせを、ブラウザの窓（window.confirm）ではなく、ツールの画面の中に出す（issue #43）
// ブラウザの窓には「ダイアログを表示しない」が付くことがあり、押されると、そのあと大事な確認が出なくなるため
import { useEffect, useRef, useState } from 'react'

type Ask = { message: string; yes: string; no: string; danger: boolean; resolve: (ok: boolean) => void }
let show: ((a: Ask) => void) | null = null
const waiting: Ask[] = []

// 確認を出して、答え（はい＝true）を待つ
export function askConfirm(message: string, opts: { yes: string; no?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const a: Ask = { message, yes: opts.yes, no: opts.no ?? 'やめる', danger: opts.danger ?? false, resolve }
    if (show) show(a)
    else waiting.push(a)
  })
}

// 画面のいちばん外側に1つ置く
export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const noRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    show = (a) => setAsk(a)
    const first = waiting.shift()
    if (first) setAsk(first)
    return () => {
      show = null
    }
  }, [])
  useEffect(() => {
    // 押しまちがえて消さないように、最初は「やめる」側に合わせる
    if (ask) noRef.current?.focus()
  }, [ask])
  if (!ask) return null
  const answer = (ok: boolean) => {
    setAsk(null)
    ask.resolve(ok)
  }
  return (
    <div className="confirm-back" data-confirm-dialog onKeyDown={(e) => e.key === 'Escape' && answer(false)}>
      <div className="confirm-box" role="alertdialog" aria-modal="true" aria-label="確認">
        <p className="confirm-msg">{ask.message}</p>
        <div className="confirm-btns">
          <button ref={noRef} className="btn btn-big" data-confirm="no" onClick={() => answer(false)}>
            {ask.no}
          </button>
          <button className={`btn btn-big ${ask.danger ? 'btn-danger' : 'btn-primary'}`} data-confirm="yes" onClick={() => answer(true)}>
            {ask.yes}
          </button>
        </div>
      </div>
    </div>
  )
}
