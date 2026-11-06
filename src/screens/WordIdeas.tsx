import { useState } from 'react'
import { callClaude, limitText } from '../lib/claude'
import { cleanLine } from '../lib/lineText'
import { maskContacts } from '../lib/extract'
import { fullMemo } from '../lib/ask'
import type { Cat } from '../types'
import type { Verdict } from '../lib/story'

// カードの言葉の案（#19。SPEC 2.4）。猫カードに入らなかった長い「いいところ」の行を、Claudeが短くした案にする
// - 押したときだけ作る。案は、本文と同じ根拠の確認（/api/check）を通ったものだけを見せる。確かめられなかったら出さない
// - 人が選んだときだけ使う（その行を案に置きかえる）。［元に戻す］で戻せる。選ばなければ何も変えない
// used：選んだ案（確認画面の側で覚える。行が短くなってカードに入ると longLines が空になるが、［元に戻す］は出し続けるため）
type Props = { cat: Cat; longLines: string[]; used: { from: string; to: string } | null; onUse: (from: string, to: string) => void; onUndo: () => void }
type Idea = { line: string; proposals: string[] }
type WordsResponse = { items?: { line: string; proposals: string[] }[]; error?: string }

export default function WordIdeas({ cat, longLines, used, onUse, onUndo }: Props) {
  const [busy, setBusy] = useState(false)
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [note, setNote] = useState('')

  const make = async () => {
    setBusy(true)
    setNote('')
    setIdeas(null)
    // メモは、ほかの窓口と同じく、履歴の形を整え、電話番号・メールを伏せてから送る（SPEC 4.2）
    const memo = maskContacts(cleanLine(fullMemo(cat)).text).text
    try {
      const w = await callClaude<WordsResponse>('/api/words', { memo, lines: longLines })
      if (!w.ok || !Array.isArray(w.body.items)) {
        setNote(limitText(w.ok ? undefined : w.error) ?? '短い言葉の案を作れませんでした。入力に戻って、短く直してください。')
        return
      }
      const all = w.body.items.flatMap((x) => x.proposals)
      if (!all.length) {
        setNote('短くした案を作れませんでした（言葉を変えずに短くできないため）。入力に戻って、短く直してください。')
        return
      }
      // 案も、本文と同じ根拠の確認を通す。メモにない事実・程度の変化があれば出さない
      const c = await callClaude<{ results?: Verdict[] }>('/api/check', { memo, facts: { name: cat.name, goodPoints: cat.goodPoints }, sentences: all })
      if (!c.ok || !Array.isArray(c.body.results) || c.body.results.length !== all.length) {
        setNote(limitText(c.ok ? undefined : c.error) ?? '案の根拠を確かめられなかったので、案は出しません。入力に戻って、短く直してください。')
        return
      }
      const passed = new Set(all.filter((_, i) => c.body.results![i]?.ok === true))
      const kept = w.body.items.map((x) => ({ line: x.line, proposals: x.proposals.filter((p) => passed.has(p)) })).filter((x) => x.proposals.length)
      if (!kept.length) setNote('メモにない言葉が入った案しか作れなかったので、出しません。入力に戻って、短く直してください。')
      setIdeas(kept)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="notice word-ideas" data-word-ideas>
      {!used && (
        <>
          <p>長くて入らなかった行を、Claudeが短くした案を出せます。案は、メモにない言葉がないか確かめてから出します。使うかどうかは、選んでください（選ばなければ、何も変えません）。</p>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void make()}>
            {busy ? '短い言葉の案を作っています…' : '短い言葉の案を出す'}
          </button>
        </>
      )}
      {note && <p className="muted">{note}</p>}
      {!used &&
        ideas?.map((x) => (
          <div key={x.line} className="word-idea">
            <p className="muted">元の行：「{x.line}」</p>
            <div className="ask-actions">
              {x.proposals.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-small"
                  onClick={() => onUse(x.line, p)}
                >
                  「{p}」を使う
                </button>
              ))}
            </div>
          </div>
        ))}
      {used && (
        <>
          <p>
            猫カードの言葉に使うため、「いいところ」の「{used.from}」を「{used.to}」に置きかえました（下の投稿文は変えていません）。
          </p>
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              onUndo()
              setIdeas(null)
            }}
          >
            元に戻す
          </button>
        </>
      )}
    </div>
  )
}
