import { useEffect, useRef, useState } from 'react'
import type { AdoptionEvent, Cat, Shelter } from '../types'
import { CHECK_MODE } from '../lib/checkMode'
import { useBlobUrl } from '../lib/useBlobUrls'
import type { Made, Method } from '../lib/video'

type Props = { cat: Cat; shelter: Shelter; event: AdoptionEvent | null; post: string; onHome: () => void; onRoster: () => void }

// 確認モードのときだけ、作り方を選んで試せる（?method=record など。②③をパソコンで確かめるため）
const forcedMethod = (): Method | undefined => {
  const m = new URLSearchParams(location.search).get('method')
  return CHECK_MODE && (m === 'frames' || m === 'record' || m === 'image') ? m : undefined
}

// 保存（SPEC 2.5）。動画を作って見せる。1ボタンで渡す画面は #9 で仕上げる
export default function Save({ cat, shelter, event, post, onHome, onRoster }: Props) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [progress, setProgress] = useState(0)
  const [made, setMade] = useState<Made | null>(null)
  const [makeError, setMakeError] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        // 動画の部品は大きいので、ここで初めて読み込む（最初に開くときを軽くするため）
        const [{ buildSegments }, { makeReel }] = await Promise.all([import('../lib/reel'), import('../lib/video')])
        const segs = await buildSegments(cat, shelter, event)
        const m = await makeReel(segs, setProgress, forcedMethod())
        setMade(m)
        if (m.kind === 'video') setUrl(URL.createObjectURL(m.blob))
      } catch (e) {
        console.warn(e)
        setMakeError(true)
      }
    })()
  }, [cat, shelter, event])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

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

      <section className="card-box reel-box">
        {!made && !makeError && (
          <div className="reel-making" role="status">
            <p>動画を作っています…（画面を閉じないでください）</p>
            <progress max={1} value={progress} aria-label="動画を作っている進み具合" />
          </div>
        )}
        {makeError && <p className="alert">動画もカードの画像も作れませんでした。確認画面に戻って、もう一度押してください。</p>}
        {made?.kind === 'video' && url && (
          <>
            <video className="reel-video" src={url} controls playsInline loop muted autoPlay data-sec={made.sec} data-method={made.method} />
            <p className="muted center">
              長さ {Math.round(made.sec)}秒
              {CHECK_MODE && `（作り方：${made.method === 'frames' ? '1コマずつ' : '録画'}・${(made.ms / 1000).toFixed(1)}秒・${(made.blob.size / 1024 / 1024).toFixed(1)}MB）`}
            </p>
          </>
        )}
        {made?.kind === 'image' && (
          <>
            <p className="notice">
              {made.failed ? '動画を作れなかったので、画像で保存します。' : 'この機種では動画を作れないため、カードを画像で保存します。'}
            </p>
            <div className="reel-images" data-count={made.images.length}>
              {made.images.map((b, i) => (
                <ImageThumb key={i} blob={b} label={`カード${i + 1}`} />
              ))}
            </div>
          </>
        )}
      </section>

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
        <p className="muted">動画と投稿文を、1回でInstagramへ渡すボタンは、これから作ります。</p>
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

function ImageThumb({ blob, label }: { blob: Blob; label: string }) {
  const src = useBlobUrl(blob)
  return src ? <img className="reel-image" src={src} alt={label} /> : null
}
