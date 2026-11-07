import { useState } from 'react'
import { copyText } from '../lib/copy'
import type { AskState } from '../lib/askState'

// 聞き返し（#18。SPEC 2.3）の欄。読み取りのすぐ下に出す
// - 預かりさんへ送るLINEの文（送る前に、欄の中で自由に直せる）と［LINEの文をコピー］［飛ばす］
// - ［LINEの文をコピー］を押したら、メモの欄の最後に「（預かりさんに聞いたこと）〜」を1行足す（ReadMemo の onCopied）
// - 返事を貼る専用の欄は作らない。返事は、メモの欄の最後に貼ってもらう（11/7 作者の決定）
// - 返事を待つ間も残す（LINEに移って戻っても消えない）。残し方は src/lib/askState.ts

type Props = {
  ask: AskState
  onEdit: (a: AskState) => void
  onCopied: (line: string) => void
  onSkip: () => void
}

export default function AskBack({ ask, onEdit, onCopied, onSkip }: Props) {
  const [copied, setCopied] = useState<boolean | null>(null)
  return (
    <div className="notice ask-back" data-ask>
      <p>
        <b>預かりさんに1つ聞いてみませんか。</b>メモに、この子のふだんの様子が少ないので、聞くと紹介が書きやすくなります。
      </p>
      <label className="field">
        <span>預かりさんへ送るLINEの文（送る前に、自由に直せます）</span>
        <textarea
          rows={4}
          value={ask.line}
          onChange={(e) => {
            setCopied(null) // 直したら、もう一度コピーしてもらう（見直しの8）
            onEdit({ ...ask, line: e.target.value })
          }}
        />
      </label>
      <div className="ask-actions">
        <button
          type="button"
          className="btn btn-small"
          disabled={!ask.line.trim()}
          onClick={() =>
            void copyText(ask.line).then((ok) => {
              setCopied(ok)
              onCopied(ask.line) // コピーできなくても（長押しでコピーしてもらう）、聞いたことはメモに足す
            })
          }
        >
          {copied ? 'コピーしました ✓' : 'LINEの文をコピー'}
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={onSkip}>
          飛ばす
        </button>
      </div>
      {copied === false && <p className="alert">コピーできませんでした。欄の文を長押しして、コピーしてください。</p>}
      {ask.noted ? (
        <p data-ask-noted>
          「{ask.noted}」を足しました。返事が来たら、LINE・メモの欄の最後に貼って、もう一度［メッセージから読み取る］を押してください。
        </p>
      ) : (
        <p className="muted">［LINEの文をコピー］を押すと、聞いたことをLINE・メモの欄の最後に1行足します（消したり直したりできます）。</p>
      )}
    </div>
  )
}
