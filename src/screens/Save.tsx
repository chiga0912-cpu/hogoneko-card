import { useState } from 'react'
import type { Cat } from '../types'

type Props = { cat: Cat; post: string; onHome: () => void; onRoster: () => void }

// 保存（仮）。動画と共有の画面は11/5に作る
export default function Save({ cat, post, onHome, onRoster }: Props) {
  const [copied, setCopied] = useState(false)

  const [copyFailed, setCopyFailed] = useState(false)

  // 本当にコピーできたときだけ「コピーしました ✓」にする
  const copy = async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(post)
      ok = true
    } catch {
      // https でないときなどの予備
      const ta = document.createElement('textarea')
      ta.value = post
      document.body.appendChild(ta)
      ta.select()
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
      ta.remove()
    }
    setCopied(ok)
    setCopyFailed(!ok)
  }

  return (
    <main className="screen">
      <header className="hero hero-small">
        <h1>名簿に保存しました ✓</h1>
        <p className="hero-lead">{cat.name}の内容は、このスマホの中に残りました。次からは「名簿から選ぶ」で開けます。</p>
      </header>

      <section className="card-box">
        <h3>投稿文</h3>
        <button className="btn btn-primary btn-big" onClick={copy}>
          {copied ? 'コピーしました ✓' : '投稿文をコピー'}
        </button>
        {copyFailed && (
          <>
            <p className="alert">コピーできませんでした。下の投稿文を長押しして、コピーしてください。</p>
            <textarea className="copy-fallback" rows={8} readOnly value={post} onFocus={(e) => e.target.select()} />
          </>
        )}
        <p className="muted">動画を作って、Instagramへ渡す画面は、これから作ります。</p>
      </section>

      <div className="stack">
        <button className="btn btn-big" onClick={onRoster}>
          名簿を見る
        </button>
        <button className="btn btn-ghost btn-big" onClick={onHome}>
          ホームへ
        </button>
      </div>
    </main>
  )
}
