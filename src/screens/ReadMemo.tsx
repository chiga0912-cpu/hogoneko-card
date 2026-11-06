import { callClaude, limitText } from '../lib/claude'
import { useState } from 'react'
import type { Cat } from '../types'
import { cleanLine } from '../lib/lineText'
import { maskContacts, type Extracted } from '../lib/extract'
import { applyExtract, type Applied } from '../lib/applyExtract'
import { fromMonthValue } from '../lib/age'

type Props = { cat: Cat; onChange: (update: (c: Cat) => Cat) => void }
type ReadResponse = { result?: Extracted; dropped?: string[]; error?: string; ms?: number }

// ［メッセージから読み取る］（SPEC 2.2 の3）。AIに送るのはメモの文字だけ（写真・動画は送らない）
export default function ReadMemo({ cat, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ applied: Applied; dropped: string[]; masked: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [limit, setLimit] = useState<string | null>(null) // 回数の上限の文（#20）

  const read = async () => {
    setBusy(true)
    setFailed(false)
    setLimit(null)
    setReport(null)
    // 履歴の形なら時刻・名前などを外し、電話番号・メールアドレスらしきものを伏せてから送る（SPEC 4.2）
    const { text: masked, masked: n } = maskContacts(cleanLine(cat.memo).text)
    try {
      const ans = await callClaude<ReadResponse>('/api/read', { memo: masked })
      if (!ans.ok) setLimit(limitText(ans.error))
      if (!ans.ok || !ans.body.result) throw new Error(ans.ok ? (ans.body.error ?? 'empty') : ans.error)
      const body = ans.body
      const result = ans.body.result
      // 入れるのは、その時点の最新の入力に対して（読み取りを待つ間に手で入れた分を消さないため）
      onChange((c) => applyExtract(c, result, c.memo).cat)
      setReport({ applied: applyExtract(cat, result, cat.memo), dropped: body.dropped ?? [], masked: n })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const s = report?.applied.ageSuggestion
  return (
    <div className="read-memo">
      <button className="btn btn-big" disabled={busy || !cat.memo.trim()} onClick={() => void read()}>
        {busy ? '読み取っています…' : 'メッセージから読み取る'}
      </button>
      {!cat.memo.trim() && <p className="muted center">メッセージを貼ると押せます。下の項目は、手でも入れられます</p>}
      {failed && <p className="alert">{limit ?? '読み取れませんでした。'}下の項目を手で入れてください。</p>}
      {report && (
        <div className="notice read-report" role="status">
          {report.applied.filled.length ? (
            <p>メモから入れました：{report.applied.filled.join('・')}。「メモから」の印を押すと、どこから読み取ったかが出ます。最後に、まちがいがないか確かめてください。</p>
          ) : (
            <p>メモから入れられる項目は見つかりませんでした。下の項目を手で入れてください。</p>
          )}
          {report.applied.skipped.length > 0 && <p className="muted">もう入っていたので変えなかった項目：{report.applied.skipped.join('・')}</p>}
          {report.dropped.length > 0 && <p className="muted">メモの中に根拠が見つからなかったので、入れなかった項目：{report.dropped.join('・')}</p>}
          {report.masked > 0 && <p className="muted">電話番号・メールアドレスらしきもの{report.masked}こは、伏せて送りました。</p>}
          {s && cat.age.mode === 'unknown' && (
            <div className="age-suggest">
              <p>
                メモに「{s.hint.source}」とあります。生まれた年月を {s.year}年{s.month}月（推定）にしますか？
              </p>
              <button
                className="btn btn-small"
                onClick={() =>
                  onChange((c) => ({
                    ...c,
                    age: { ...fromMonthValue(`${s.year}-${String(s.month).padStart(2, '0')}`), mode: 'birth', estimated: true },
                    sources: { ...c.sources, age: s.hint.source },
                  }))
                }
              >
                推定で入れる
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 「メモから」の印。押すと、メモのどの部分から読み取ったかが出る
export function FromMemo({ source }: { source: string | undefined }) {
  const [open, setOpen] = useState(false)
  if (!source) return null
  return (
    <>
      {/* 入力欄の名前（label）の中に置くので、button ではなく span にする（label が入力欄ではなく印を指してしまうため） */}
      <span
        role="button"
        tabIndex={0}
        className="from-memo"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault()
          setOpen(!open)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(!open)
          }
        }}
      >
        メモから
      </span>
      {open && <q className="from-memo-src">{source}</q>}
    </>
  )
}
