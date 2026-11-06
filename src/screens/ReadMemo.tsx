import { callClaude, limitText } from '../lib/claude'
import { useState } from 'react'
import type { Cat } from '../types'
import { cleanLine } from '../lib/lineText'
import { maskContacts, type Extracted } from '../lib/extract'
import { applyExtract, type Applied } from '../lib/applyExtract'
import { fromMonthValue } from '../lib/age'
import { askLine, fullMemo, replyAddition } from '../lib/ask'
import AskBack from './AskBack'
import { loadAsk, saveAsk, type AskState } from '../lib/askState'

type Props = { cat: Cat; onChange: (update: (c: Cat) => Cat) => void }
type ReadResponse = { result?: Extracted; dropped?: string[]; error?: string; ms?: number }
type AskResponse = { question?: string | null; skipped?: string | null }

// ［メッセージから読み取る］（SPEC 2.2 の3）。AIに送るのはメモの文字だけ（写真・動画は送らない）
export default function ReadMemo({ cat, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ applied: Applied; dropped: string[]; masked: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [limit, setLimit] = useState<string | null>(null) // 回数の上限の文（#20）
  // 聞き返し（#18。SPEC 2.3）。このメモに対する聞き返しの下書き（返事を待つ間も残す）
  const [ask, setAskState] = useState<AskState | null>(() => loadAsk(cat.memo))
  const setAsk = (a: AskState | null) => {
    setAskState(a)
    saveAsk(a)
  }
  const [asking, setAsking] = useState(false)

  // 聞き返しが要るかをClaudeに聞く。同じメモでは一度だけ（質問が出なかった・飛ばした・返事を足したあとは聞かない）
  // 失敗したとき・上限のときは、何も出さずに先へ進める（聞き返しは必ずではない）
  const askBack = async (masked: string, name: string, memoKey: string) => {
    const known = loadAsk(memoKey)
    if (known) return
    setAsking(true)
    try {
      const ans = await callClaude<AskResponse>('/api/ask', { memo: masked })
      if (!ans.ok) return
      const q = typeof ans.body.question === 'string' ? ans.body.question : null
      if (q) setAsk({ memo: memoKey, line: askLine(name, q), reply: '', status: 'open' })
      // 「要らない」「メモにない事実が入った」ときだけ、このメモではもう聞かない。一時的な失敗なら、次に読み取ったときにもう一度考える（見直しの2）
      else if (ans.body.skipped === 'not-needed' || ans.body.skipped === 'unsupported') setAsk({ memo: memoKey, line: '', reply: '', status: 'none' })
    } finally {
      setAsking(false)
    }
  }

  // memoText：読み取りに使うメモ（元のメモ＋足した返事）。askAfter：読み取りのあとで聞き返しを考えるか
  const read = async (memoText = fullMemo(cat), askAfter = true) => {
    setBusy(true)
    setFailed(false)
    setLimit(null)
    setReport(null)
    // 履歴の形なら時刻・名前などを外し、電話番号・メールアドレスらしきものを伏せてから送る（SPEC 4.2）
    const { text: masked, masked: n } = maskContacts(cleanLine(memoText).text)
    try {
      const ans = await callClaude<ReadResponse>('/api/read', { memo: masked })
      if (!ans.ok) setLimit(limitText(ans.error))
      if (!ans.ok || !ans.body.result) throw new Error(ans.ok ? (ans.body.error ?? 'empty') : ans.error)
      const body = ans.body
      const result = ans.body.result
      // 入れるのは、その時点の最新の入力に対して（読み取りを待つ間に手で入れた分を消さないため）
      // 根拠の照合は、送ったメモ（返事を足したならそれも含む）で行う
      onChange((c) => applyExtract(c, result, memoText).cat)
      setReport({ applied: applyExtract(cat, result, memoText), dropped: body.dropped ?? [], masked: n })
      // 返事をまだ足していなければ、聞き返しが要るかを考える
      if (askAfter && !cat.memoAdditions.trim()) await askBack(masked, cat.name.trim() || result.name?.value || '', cat.memo)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  // 返事は書き換えずに、元のメモの最後に「（預かりさんの返事）」として足し、読み取り直す（SPEC 2.3）
  const addReply = (reply: string) => {
    if (!ask) return
    const addition = replyAddition(reply)
    const additions = cat.memoAdditions.trim() ? `${cat.memoAdditions}\n${addition}` : addition
    onChange((c) => ({ ...c, memoAdditions: c.memoAdditions.trim() ? `${c.memoAdditions}\n${addition}` : addition }))
    setAsk({ ...ask, status: 'added' })
    void read(fullMemo({ memo: cat.memo, memoAdditions: additions }), false)
  }
  const showAsk = ask && ask.memo === cat.memo && ask.status === 'open'

  const s = report?.applied.ageSuggestion
  return (
    <div className="read-memo">
      <button className="btn btn-big" disabled={busy || asking || !cat.memo.trim()} onClick={() => void read()}>
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
      {/* 聞き返し（#18）。読み取りの結果の知らせのあとに出す */}
      {asking && <p className="muted center">預かりさんに聞くことがあるか、考えています…</p>}
      {showAsk && ask && <AskBack ask={ask} onEdit={setAsk} onAdd={addReply} onSkip={() => setAsk({ ...ask, status: 'skipped' })} />}
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
