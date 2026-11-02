import { useState } from 'react'
import { TopBar } from './ShelterForm'

type Props = { post: string; onBack: () => void; onHome: () => void }

export default function Save({ post, onBack, onHome }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(post)
    } catch {
      // 古いブラウザ向けの予備
      const ta = document.createElement('textarea')
      ta.value = post
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="screen">
      <TopBar title="保存" onBack={onBack} />

      <section className="card-box">
        <h3>1. 画像をスマホに保存</h3>
        <button className="btn btn-big" disabled>
          画像を保存
          <span className="soon">11/3につくります</span>
        </button>
      </section>

      <section className="card-box">
        <h3>2. 投稿文をコピー</h3>
        <button className="btn btn-primary btn-big" onClick={copy}>
          {copied ? 'コピーしました ✓' : '投稿文をコピー'}
        </button>
        <p className="muted">Instagramのリール編集で画像を並べ、投稿文を貼りつけてください。</p>
      </section>

      <p className="note">投稿の前に、内容がまちがっていないか必ず確認してください。</p>

      <div className="bottom-bar">
        <button className="btn btn-ghost btn-big" onClick={onHome}>
          はじめに戻る
        </button>
      </div>
    </main>
  )
}
