import { useState } from 'react'
import { copyText } from '../lib/copy'
import type { AskState } from '../lib/askState'

// 聞き返し（#18。SPEC 2.3）の欄。読み取りのすぐ下に出す
// - 預かりさんへ送るLINEの文（送る前に、欄の中で自由に直せる）と［LINEの文をコピー］
// - 返事を貼る欄（自分で書いても、キーボードのマイクで話してもよい）と［返事をメモに足す］［飛ばす］
// - 返事を待つ間も残す（LINEに移って戻っても消えない）。残し方は src/lib/askState.ts

type Props = {
  ask: AskState
  onEdit: (a: AskState) => void
  onAdd: (reply: string) => void
  onSkip: () => void
}

export default function AskBack({ ask, onEdit, onAdd, onSkip }: Props) {
  const [copied, setCopied] = useState<boolean | null>(null)
  return (
    <div className="notice ask-back" data-ask>
      <p>
        <b>預かりさんに1つ聞いてみませんか。</b>メモに、この子のふだんの様子が少ないので、聞くと紹介が書きやすくなります。
      </p>
      <label className="field">
        <span>預かりさんへ送るLINEの文（送る前に、自由に直せます）</span>
        <textarea rows={4} value={ask.line} onChange={(e) => onEdit({ ...ask, line: e.target.value })} />
      </label>
      <button
        type="button"
        className="btn btn-small"
        disabled={!ask.line.trim()}
        onClick={() => void copyText(ask.line).then((ok) => setCopied(ok))}
      >
        {copied ? 'コピーしました ✓' : 'LINEの文をコピー'}
      </button>
      {copied === false && <p className="alert">コピーできませんでした。欄の文を長押しして、コピーしてください。</p>}
      <label className="field">
        <span>預かりさんの返事（貼るか、書いてください。キーボードのマイクで話してもOK）</span>
        <textarea rows={4} value={ask.reply} onChange={(e) => onEdit({ ...ask, reply: e.target.value })} />
      </label>
      <div className="ask-actions">
        <button type="button" className="btn btn-small" disabled={!ask.reply.trim()} onClick={() => onAdd(ask.reply)}>
          返事をメモに足す
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={onSkip}>
          飛ばす
        </button>
      </div>
      <p className="muted">返事を待つ間も、この欄は残ります（LINEに移って戻っても消えません）。返事は書き換えずに、メモの最後に足します。</p>
    </div>
  )
}
