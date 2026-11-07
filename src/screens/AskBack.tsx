import { useRef, useState } from 'react'
import { copyText } from '../lib/copy'
import { flushTyped } from '../lib/typed'
import type { AskState } from '../lib/askState'

// 聞き返し（#18。SPEC 2.3）の欄。読み取りのすぐ下に出す
// - 預かりさんへ送るLINEの文（送る前に、欄の中で自由に直せる）と［LINEの文をコピー］［飛ばす］
// - ［LINEの文をコピー］を押しても、メモの欄には何も足さない。コピーの後に、返事をメモの欄に貼る案内を出す（11/7 夕方 作者の決定）
// - 返事を貼る専用の欄は作らない
// - 返事を待つ間も残す（LINEに移って戻っても消えない）。残し方は src/lib/askState.ts

type Props = {
  ask: AskState
  onEdit: (a: AskState) => void
  onCopied: (line: string) => void
  onSkip: () => void
}

export default function AskBack({ ask, onEdit, onCopied, onSkip }: Props) {
  const [copied, setCopied] = useState<boolean | null>(null)
  const lineBox = useRef<HTMLTextAreaElement>(null)
  const skipLatest = useRef(onSkip)
  skipLatest.current = onSkip
  return (
    <div className="notice ask-back" data-ask>
      <p>
        <b>預かりさんに1つ聞いてみませんか。</b>メモに、この子のふだんの様子が少ないので、聞くと紹介が書きやすくなります。
      </p>
      <label className="field">
        <span>預かりさんへ送るLINEの文（送る前に、自由に直せます）</span>
        <textarea
          ref={lineBox}
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
          onClick={() => {
            // 欄に見えている文をコピーする（iPhone の日本語入力で、変換を確定する前に押しても、最後の文字まで。11/7）
            // コピーは押したその場で行う（あとに回すと、スマホがコピーを許さないことがあるため）
            flushTyped(lineBox.current)
            const line = lineBox.current?.value ?? ask.line
            void copyText(line).then((ok) => {
              setCopied(ok)
              onCopied(line) // コピーできなくても（長押しでコピーしてもらう）、案内は出す
            })
          }}
        >
          {copied ? 'コピーしました ✓' : 'LINEの文をコピー'}
        </button>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          onClick={() => {
            flushTyped(lineBox.current) // 変換を確定する前の文字も入れてから（11/7 夜 作者の指示）
            window.setTimeout(() => skipLatest.current(), 0)
          }}
        >
          飛ばす
        </button>
      </div>
      {copied === false && <p className="alert">コピーできませんでした。欄の文を長押しして、コピーしてください。</p>}
      {/* コピーの前の説明は出さない。コピーの後だけ案内する（11/7 夕方 作者の決定） */}
      {ask.copied && <p data-ask-copied>返事が来たら、LINE・メモの欄に貼って、もう一度［メッセージから読み取る］を押してください。</p>}
    </div>
  )
}
