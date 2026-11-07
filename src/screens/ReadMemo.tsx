import { callClaude, limitText } from '../lib/claude'
import { useRef, useState } from 'react'
import type { Cat } from '../types'
import { cleanLine } from '../lib/lineText'
import { maskContacts, type Extracted } from '../lib/extract'
import { applyExtract, type Applied } from '../lib/applyExtract'
import { fromMonthValue } from '../lib/age'
import { alreadyAsked, askLine, fullMemo } from '../lib/ask'
import AskBack from './AskBack'
import { loadAsk, markAsked, saveAsk, wasAsked, type AskState } from '../lib/askState'

// beforeRead：読み取る前に、入力中の欄の文字を確定して入力に入れる（iPhone の日本語入力で、変換を確定する前に押したときのため。CatForm の commitTyped）
type Props = { cat: Cat; onChange: (update: (c: Cat) => Cat) => void; beforeRead?: () => void }
type ReadResponse = { result?: Extracted; dropped?: string[]; error?: string; ms?: number }
type AskResponse = { question?: string | null; skipped?: string | null }

// ［メッセージから読み取る］（SPEC 2.2 の3）。AIに送るのはメモの文字だけ（写真・動画は送らない）
export default function ReadMemo({ cat, onChange, beforeRead }: Props) {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ applied: Applied; dropped: string[]; masked: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [limit, setLimit] = useState<string | null>(null) // 回数の上限の文（#20）
  // 聞き返し（#18。SPEC 2.3）。このメモに対する聞き返しの下書き（返事を待つ間も残す）
  const [ask, setAskState] = useState<AskState | null>(() => loadAsk(cat.memo, cat.id))
  const setAsk = (a: AskState | null) => {
    setAskState(a)
    saveAsk(a)
  }
  const [asking, setAsking] = useState(false)
  // 聞き返しが要るかをClaudeに聞く。同じメモでは一度だけ（質問が出なかった・飛ばした・返事を足したあとは聞かない）
  // 失敗したとき・上限のときは、何も出さずに先へ進める（聞き返しは必ずではない）
  const askBack = async (masked: string, name: string, memoKey: string) => {
    const known = loadAsk(memoKey, cat.id)
    if (known) return
    setAsking(true)
    try {
      const ans = await callClaude<AskResponse>('/api/ask', { memo: masked })
      if (!ans.ok) return
      const q = typeof ans.body.question === 'string' ? ans.body.question : null
      if (q) {
        setAsk({ memo: memoKey, catId: cat.id, line: askLine(name, q), reply: '', status: 'open' })
      }
      // 「要らない」「メモにない事実が入った」ときだけ、このメモではもう聞かない。一時的な失敗なら、次に読み取ったときにもう一度考える（見直しの2）
      else if (ans.body.skipped === 'not-needed' || ans.body.skipped === 'unsupported') setAsk({ memo: memoKey, catId: cat.id, line: '', reply: '', status: 'none' })
    } finally {
      setAsking(false)
    }
  }

  // memoText：読み取りに使うメモ。askAfter：読み取りのあとで聞き返しを考えるか
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
      onChange((c) => applyExtract(c, result).cat)
      // 「いいところ」「ひとこと」は人が書く欄なので、入れなかった項目にも出さない（11/7 作者の決定）
      const dropped = (body.dropped ?? []).filter((d) => !d.startsWith('いいところ') && d !== 'ひとこと')
      setReport({ applied: applyExtract(cat, result), dropped, masked: n })
      // まだ聞いていなければ（メモに「聞いたこと」の行がなければ）、聞き返しが要るかを考える
      // まだ聞いていなければ（この子に質問を出したことがなく、前の版の「聞いたこと」の行もなければ）、聞き返しが要るかを考える
      if (askAfter && !wasAsked(cat.id) && !alreadyAsked(cat.memo)) await askBack(masked, cat.name.trim() || result.name?.value || '', cat.memo)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  // ［LINEの文をコピー］を押したら、メモの欄の最後に「（預かりさんに聞いたこと）〜」を1行足す（11/7 作者の決定）。
  // 返事が来たら、スタッフさんがメモの欄の最後に貼って、もう一度読み取る。足した行は、人が消したり直したりできる
  // ［LINEの文をコピー］を押した：メモの欄には何も足さない（11/7 夕方 作者の決定）。コピーの後の案内を出すために覚える
  const onCopied = (line: string) => {
    if (!ask) return
    setAsk({ ...ask, line, copied: true }) // line：コピーした文（欄に見えていた文）
    markAsked(cat.id) // 1匹に1回：［LINEの文をコピー］か［飛ばす］を押したときだけ覚える（11/7 夜 作者の決定）
  }
  const showAsk = ask && ask.memo === cat.memo && ask.status === 'open'

  const s = report?.applied.ageSuggestion
  // 押したら、欄に見えている文字を入力に入れ、画面が描き直されてから（今のメモで）読み取る（11/7 作者が iPhone で見つけた件と同じ）
  const readLatest = useRef(read)
  readLatest.current = read
  const onRead = () => {
    beforeRead?.()
    window.setTimeout(() => void readLatest.current(), 0)
  }

  return (
    <div className="read-memo">
      <button className="btn btn-big" disabled={busy || asking || !cat.memo.trim()} onClick={onRead}>
        {busy ? '読み取っています…' : 'メッセージから読み取る'}
      </button>
      {!cat.memo.trim() && <p className="muted center">メッセージを貼ると押せます。下の項目は、手でも入れられます</p>}
      {failed && <p className="alert">{limit ?? '読み取れませんでした。'}下の項目を手で入れてください。</p>}
      {report && (
        <div className="notice read-report" role="status">
          {report.applied.filled.length ? (
            <p>メモから入れました：{report.applied.filled.join('・')}。「メモから」の印を押すと、どこから読み取ったかが出ます。最後に、まちがいがないか確かめてください。</p>
          ) : report.applied.skipped.length === 0 ? (
            // 項目が1つも見つからなかったとき（11/8 作者の決定）。メモの内容は、本文を書くときに使う
            <p data-read-none>名前・年齢・性別・健康のことは、メモから見つけられませんでした。名前は下の欄に入れ、年齢や健康のことは下のボタンで選んでください。メモの内容は、次の画面で紹介文を書くときに使います。</p>
          ) : null /* メモにあった項目がもう入っていただけのときは、下の「もう入っていたので変えなかった項目」だけを出す ⚙ */}
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
      {showAsk && ask && <AskBack ask={ask} onEdit={setAsk} onCopied={onCopied} onSkip={() => {
            setAsk({ ...ask, status: 'skipped' })
            markAsked(cat.id) // 1匹に1回（［飛ばす］も聞いたことにする）
          }} />}
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
