import { callClaude, limitText } from '../lib/claude'
import { useRef, useState } from 'react'
import type { Cat, Shelter } from '../types'
import { cleanLine } from '../lib/lineText'
import { maskContacts } from '../lib/extract'
import { makeFixedPost } from '../lib/post'
import { storyReady, type StoryResult } from '../lib/story'
import { askConfirm } from '../lib/confirm'
import { fullMemo } from '../lib/ask'

// 今の入力（App が持つ最新の値）。本文が届くまでに［戻る］で入力を変えても、届いたときの今の入力で投稿文を組み立てる
export type Live = { cat: Cat; post: string; postEdited: boolean; shelter: Shelter | null }

type Props = {
  cat: Cat
  shelter: Shelter
  post: string
  onPost: (post: string, story: StoryResult) => void
  live?: () => Live
}

// ［物語の本文を書いてもらう］（#16。SPEC 4.1・4.2・4.4）。AIに送るのはメモの文字と、確認した名前・いいところだけ
// Claudeが書くのは本文だけ。年齢・性別・健康・毎回の文・連絡先・ハッシュタグは、決まった形でプログラムが足す
export default function WriteStory({ cat, shelter, post, onPost, live }: Props) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [limit, setLimit] = useState<string | null>(null) // 回数の上限の文（#20）
  const [masked, setMasked] = useState(0)
  const [lastPost, setLastPost] = useState<string | null>(null) // 前にClaudeの本文で作った投稿文（それなら聞かずに置きかえる）
  const latestPost = useRef(post) // 答えが届いたときの、今の投稿文
  latestPost.current = post
  const facts = { name: cat.name, goodPoints: cat.goodPoints }
  const memo = fullMemo(cat) // 元のメモ＋聞き返しで足した返事（#18）

  const write = async () => {
    // 手で直した投稿文を、黙って置きかえない（SPEC 2.4）
    // 手で直したかは App が持つ印で見る（画面を行き来すると lastPost が消え、Claudeの本文の投稿文でも「手で直しています」と聞いてしまうため）
    const edited = live ? live().postEdited : post !== lastPost
    if (post.trim() && post !== makeFixedPost(cat, shelter) && edited && !(await askConfirm('投稿文を手で直しています。Claudeが書いた本文の投稿文に置きかえますか？', { yes: '置きかえる' })))
      return
    const before = post
    setBusy(true)
    setFailed(false)
    setLimit(null)
    // 履歴の形なら時刻・名前などを外し、電話番号・メールアドレスらしきものを伏せてから送る（SPEC 4.2）
    const { text, masked: n } = maskContacts(cleanLine(memo).text)
    setMasked(n)
    try {
      const ans = await callClaude<{ result?: StoryResult; error?: string }>('/api/post', { memo: text, facts })
      if (!ans.ok) setLimit(limitText(ans.error))
      if (!ans.ok || !ans.body.result) throw new Error(ans.ok ? (ans.body.error ?? 'empty') : ans.error)
      const body = ans.body as { result: StoryResult }
      // 投稿文は、書き始めたときではなく今の入力（性別・年齢・健康・名前など）で組み立てる（#23のあとの見直しの重い1）
      // 書いている間に［戻る］で入力を変えても、古い入力の投稿文に戻さない。メモ・名前・いいところが変わったことは、根拠の確認の「確かめ直す」で止まる
      const now = live?.()
      if (now && now.cat.id !== cat.id) return // 書いている間に別の子になった。届いた本文は使わない
      const next = makeFixedPost(now?.cat ?? cat, now?.shelter ?? shelter, new Date(), body.result.body)
      // 書いている間に投稿文を手で直していたら、黙って置きかえない（見直しの重い6）
      // 入力を変えて投稿文が作り直されただけ（手で直していない）なら、聞かない
      const handEdited = now ? now.postEdited && now.post !== before : latestPost.current !== before
      if (handEdited && !(await askConfirm('本文を書いている間に、投稿文が直されました。Claudeが書いた本文の投稿文に置きかえますか？', { yes: '置きかえる' })))
        return
      setLastPost(next)
      onPost(next, body.result)
    } catch {
      // Claudeが使えないときは、決まった形の投稿文のまま（SPEC 4.4）
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="write-story">
      <button className="btn btn-big" disabled={busy || !storyReady(memo, facts)} onClick={() => void write()}>
        {busy ? '本文を書いています…' : '物語の本文を書いてもらう'}
      </button>
      {!storyReady(memo, facts) && <p className="muted center">メッセージか「いいところ」を入れると押せます</p>}
      {failed && <p className="alert">{limit ?? '本文を書けませんでした。'}下の投稿文は決まった形のままです。そのまま使うか、手で書き足してください。</p>}
      {masked > 0 && !busy && <p className="muted">電話番号・メールアドレスらしきもの{masked}こは、伏せて送りました。</p>}
    </div>
  )
}
