import { useState } from 'react'
import { CLOSINGS, type StoryCite, type StoryResult, type Verdict } from '../lib/story'

// 根拠の確認の結果（#17。SPEC 2.4）
// - 本文の文ごとに、メモに根拠があるかを出す。押すと、メモの中の根拠の言葉が光る
// - 根拠がない文は、黄色の線と「⚠ メモにありません」。［消す］か［本当です（残す）］を人が選ぶ
// - 本文を確かめたあとでメモが変わったら（足した返事を外したときも）、✓ を消して「メモが変わりました」と出し、確かめ直してもらう（#23 重い1）
// - 本文のあとの決まった文は「決まった文」、年齢・健康・連絡先などは「入力から」（印の対象にしない）
export type CheckState =
  | { status: 'checking' }
  | { status: 'failed'; limit?: string | null } // limit：回数の上限の文（#20）
  | { status: 'stale'; failed?: boolean; limit?: string | null } // 本文を確かめたときのメモと今のメモが違う（#23 重い1。✓ は出さない）。failed：確かめ直しに失敗した
  | { status: 'done'; sentences: string[]; verdicts: Verdict[]; kept: number[]; removed?: number[] }

type Props = {
  story: StoryResult
  check: CheckState
  name: string
  post: string
  onKeep: (i: number) => void
  onRemove: (i: number, sentence: string) => void
  onRetry: () => void
  onDropStory: () => void
}

// まだ人が選んでいない、印の文（投稿文に残っているものだけ）
export function openFlags(check: CheckState, post: string): number[] {
  if (check.status !== 'done') return []
  // 投稿文から消した文（文として見つからない、かつ［消す］で消した）だけを片づいたとみなす。手で直しただけの文は印が残る
  void post
  return check.verdicts.filter((v) => !v.ok && !check.kept.includes(v.i) && !(check.removed ?? []).includes(v.i)).map((v) => v.i)
}

export default function StoryCheck({ story, check, name, post, onKeep, onRemove, onRetry, onDropStory }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  if (check.status === 'checking') return <p className="notice story-check" role="status">メモに根拠があるか、1文ずつ確かめています…</p>
  if (check.status === 'stale')
    return (
      <div className="alert story-check" role="status" data-story-stale="1">
        <p>メモが変わりました。もう一度確かめてください。確かめるまで［動画を作る］は押せません。</p>
        {/* 確かめ直しに失敗したときは、そのことを出す（ボタンが効かないように見えないように。見直しの中1） */}
        {check.failed && <p>{check.limit ?? '本文の根拠を確かめられませんでした。もう一度押してください。'}{check.limit ? '本文を外すと、決まった形の投稿文で動画を作れます。' : ''}</p>}
        <div className="story-check-actions">
          <button className="btn btn-small" onClick={onRetry}>
            もう一度確かめる
          </button>
          <button className="btn btn-small btn-ghost" onClick={onDropStory}>
            本文を外して、決まった形に戻す
          </button>
        </div>
      </div>
    )
  if (check.status === 'failed')
    return (
      <div className="alert story-check" role="status">
        <p>{check.limit ?? '本文の根拠を確かめられませんでした。'}確かめるまで［動画を作る］は押せません。{check.limit ? '本文を外すと、決まった形の投稿文で動画を作れます。' : ''}</p>
        <div className="story-check-actions">
          <button className="btn btn-small" onClick={onRetry}>
            もう一度確かめる
          </button>
          <button className="btn btn-small btn-ghost" onClick={onDropStory}>
            本文を外して、決まった形に戻す
          </button>
        </div>
      </div>
    )
  const closing = CLOSINGS.map((f) => f(name.trim())).find((c) => post.includes(c))
  const lit = (cites: StoryCite[]) => (doc: 0 | 1, i: number) => cites.some((c) => c.doc === doc && i >= c.start && i < c.end)
  return (
    <section className="story-check" aria-label="本文の根拠">
      <h3>本文の根拠</h3>
      <p className="muted">文を押すと、メモのどこから来たかが光ります。</p>
      <ul>
        {check.sentences.map((s, i) => {
          const v = check.verdicts[i]
          const kept = check.kept.includes(i)
          const removed = (check.removed ?? []).includes(i)
          const found = post.includes(s)
          if (removed || (!found && (v.ok || kept))) return null // ［消す］で消した文・印のない文で見つからないものは出さない
          const flagged = !v.ok && !kept
          const on = lit([...v.cites, ...story.parts.filter((p) => p.text.includes(s) || s.includes(p.text.trim())).flatMap((p) => p.cites)])
          return (
            <li key={i} className={`story-line ${flagged ? 'story-flag' : ''}`} data-flag={flagged ? '1' : '0'} id={`story-line-${i}`}>
              <button className="story-text" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                {v.ok ? '✓ ' : kept ? '✓（残す） ' : '⚠ '}
                {s}
              </button>
              {flagged && (
                <div className="story-flag-box">
                  <p>⚠ メモにありません{v.reason && v.reason !== 'メモに根拠が見つかりませんでした' ? `（${v.reason}）` : ''}</p>
                  {!found && <p className="muted">この文は投稿文で直されています。直した文を読んで確かめたら、［本当です（残す）］を押してください。</p>}
                  <div className="story-check-actions">
                    {found && (
                      <button className="btn btn-small" onClick={() => onRemove(i, s)}>
                        消す
                      </button>
                    )}
                    <button className="btn btn-small btn-ghost" onClick={() => onKeep(i)}>
                      本当です（残す）
                    </button>
                  </div>
                </div>
              )}
              {open === i && (
                <div className="story-source">
                  {v.ok ? null : <p className="muted">メモの中に、この文の根拠は見つかりませんでした。</p>}
                  <p className="muted">メモ</p>
                  <p className="story-memo">
                    {story.memoChunks.map((c, k) => (
                      <mark key={k} className={on(0, k) ? 'story-lit' : 'story-plain'}>
                        {c}
                      </mark>
                    ))}
                  </p>
                  {story.factChunks.some((_, k) => on(1, k)) && (
                    <>
                      <p className="muted">確認した項目</p>
                      <p className="story-memo">
                        {story.factChunks.map((c, k) => (
                          <mark key={k} className={on(1, k) ? 'story-lit' : 'story-plain'}>
                            {c}
                          </mark>
                        ))}
                      </p>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
        {closing && (
          <li className="story-line">
            <span className="story-text story-fixed">
              <span className="story-tag">決まった文</span>
              {closing}
            </span>
          </li>
        )}
      </ul>
      <p className="muted">年齢・性別・健康・ひとこと・毎回の文・連絡先・ハッシュタグは「入力から」プログラムが足しています（印の対象ではありません）。</p>
    </section>
  )
}
