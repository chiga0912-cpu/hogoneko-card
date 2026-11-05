import { useEffect, useRef, useState } from 'react'
import type { AdoptionEvent, Cat, Shelter } from '../types'
import { CHECK_MODE } from '../lib/checkMode'
import { useBlobUrl } from '../lib/useBlobUrls'
import type { Made, Method } from '../lib/video'

type Props = {
  cat: Cat
  shelter: Shelter
  event: AdoptionEvent | null
  post: string
  onHome: () => void
  onRoster: () => void
  onBackToPreview: () => void
}

// 確認モードのときだけ、作り方を選んで試せる（?method=record など。②③をパソコンで確かめるため）
const forcedMethod = (): Method | undefined => {
  const m = new URLSearchParams(location.search).get('method')
  return CHECK_MODE && (m === 'frames' || m === 'record' || m === 'image') ? m : undefined
}

// 保存（SPEC 2.5）。動画を作って見せ、大きいボタン1つで、投稿文をコピーしてから共有の画面（Instagramへ）を開く
export default function Save({ cat, shelter, event, post, onHome, onRoster, onBackToPreview }: Props) {
  const [progress, setProgress] = useState(0)
  const [made, setMade] = useState<Made | null>(null)
  const [makeError, setMakeError] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  // 位置情報の確認（作ったあとすぐに行う。ボタンを押したあとに調べると、共有の画面を開けなくなるため）
  const [geo, setGeo] = useState<'checking' | 'あり' | 'なし' | '調べられない'>('checking')
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [shareNote, setShareNote] = useState('')
  const started = useRef(false)
  const failRef = useRef<HTMLParagraphElement>(null)
  // 知らせは、押したボタンのすぐ下に出し、見える所まで動かす
  useEffect(() => {
    if (copyFailed) failRef.current?.scrollIntoView({ block: 'nearest' })
  }, [copyFailed, shareNote])

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        // 動画の部品は大きいので、ここで初めて読み込む（最初に開くときを軽くするため）
        const [{ buildSegments }, v] = await Promise.all([import('../lib/reel'), import('../lib/video')])
        const segs = await buildSegments(cat, shelter, event)
        const m = await v.makeReel(segs, setProgress, forcedMethod())
        setMade(m)
        if (m.kind === 'video') setUrl(URL.createObjectURL(m.blob))
        const results = m.kind === 'video' ? [await v.videoHasLocation(m.blob)] : await Promise.all(m.images.map(v.imageHasLocation))
        setGeo(results.includes('あり') ? 'あり' : results.includes('調べられない') ? '調べられない' : 'なし')
      } catch (e) {
        console.warn(e)
        setMakeError(true)
      }
    })()
  }, [cat, shelter, event])
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )

  const files = (): File[] => {
    if (!made) return []
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
    return made.kind === 'video'
      ? [new File([made.blob], `hogoneko-${stamp}.mp4`, { type: 'video/mp4' })]
      : made.images.map((b, i) => new File([b], `hogoneko-${stamp}-${i + 1}.jpg`, { type: 'image/jpeg' }))
  }

  // 大きいボタン：押した瞬間に投稿文をコピーし、続けて共有の画面を開く（テストCで、1タップで両方できることを確認済み）
  // コピーは待たずに始める（共有の画面は、押した直後でないと開けないため）
  const copyAndShare = async () => {
    setShareNote('')
    // コピーの結果は、共有の画面を閉じるのを待たずに出す（失敗したまま気づかずにInstagramへ行かないように）
    const copying = copyText(post).then((ok) => {
      setCopied(ok)
      setCopyFailed(!ok)
      return ok
    })
    const fs = files()
    let shared: 'done' | 'cancel' | 'cannot' | 'error' = 'cannot'
    if (typeof navigator.share === 'function' && (navigator.canShare?.({ files: fs }) ?? true)) {
      try {
        await navigator.share({ files: fs })
        shared = 'done'
      } catch (e) {
        shared = (e as Error).name === 'AbortError' ? 'cancel' : 'error'
      }
    }
    await copying
    if (shared === 'cannot' || shared === 'error')
      setShareNote(
        made?.kind === 'video'
          ? '共有の画面を開けませんでした。上の動画を長押しして保存し、Instagramで選んでください。'
          : '共有の画面を開けませんでした。上の画像を長押しして保存し、Instagramで選んでください。',
      )
  }

  const ready = made !== null && geo !== 'checking' && geo !== 'あり'

  return (
    <main className="screen">
      <header className="hero hero-small">
        <h1>名簿に保存しました ✓</h1>
        <p className="hero-lead">{cat.name}の内容は、このスマホの中に残りました。次からは「名簿から選ぶ」で開けます。</p>
      </header>

      {made?.kind === 'image' && (
        <p className="notice">
          {made.failed ? '動画を作れなかったので、画像で保存します。' : 'この機種では動画を作れないため、カードを画像で保存します。'}
        </p>
      )}

      <section className="card-box reel-box">
        {!made && !makeError && (
          <div className="reel-making" role="status">
            <p>動画を作っています…（画面を閉じないでください）</p>
            <progress max={1} value={progress} aria-label="動画を作っている進み具合" />
          </div>
        )}
        {makeError && (
          <>
            <p className="alert">動画もカードの画像も作れませんでした。確認画面に戻って、もう一度押してください。</p>
            <button className="btn btn-big" onClick={onBackToPreview}>
              確認画面に戻る
            </button>
          </>
        )}
        {made?.kind === 'video' && url && (
          <>
            <video className="reel-video" src={url} controls playsInline loop muted autoPlay data-sec={made.sec} data-method={made.method} />
            <p className="muted center">
              長さ {Math.round(made.sec)}秒
              {CHECK_MODE && `（作り方：${made.method === 'frames' ? '1コマずつ' : '録画'}・${(made.ms / 1000).toFixed(1)}秒・${(made.blob.size / 1_000_000).toFixed(1)}MB）`}
            </p>
          </>
        )}
        {made?.kind === 'image' && (
          <div className="reel-images" data-count={made.images.length}>
            {made.images.map((b, i) => (
              <ImageThumb key={i} blob={b} label={`カード${i + 1}`} />
            ))}
          </div>
        )}
        {CHECK_MODE && made && <p className="muted center" data-testid="location">位置情報：{geo === 'checking' ? '確認中' : geo}</p>}
      </section>

      {geo === 'あり' && (
        <>
          <p className="alert">できた{made?.kind === 'image' ? '画像' : '動画'}に位置情報が入っていたので、保存をやめました。確認画面に戻って、もう一度作ってください。</p>
          <button className="btn btn-big" onClick={onBackToPreview}>
            確認画面に戻る
          </button>
        </>
      )}
      {geo === '調べられない' && <p className="notice">位置情報が入っていないかを、確かめられませんでした。</p>}

      <section className="share-box">
        <button className="btn btn-primary btn-big btn-share" disabled={!ready} onClick={() => void copyAndShare()}>
          {copied ? 'コピーしました ✓' : '投稿文をコピーしてInstagramへ'}
        </button>
        {copied && <p className="muted center">もう一度押すと、もう一度コピーして開きます</p>}
        {copyFailed && (
          <>
            <p className="alert" ref={failRef}>投稿文をコピーできませんでした。下の投稿文を長押しして、コピーしてください。</p>
            <textarea className="copy-fallback" rows={8} readOnly value={post} onFocus={(e) => e.target.select()} />
          </>
        )}
        {shareNote && <p className="alert">{shareNote}</p>}
        <ol className="share-steps">
          <li>出てきた画面で「Instagram」を選ぶ</li>
          <li>「リール」を選ぶ</li>
          <li>説明文の欄を長押しして「ペースト」（投稿文はコピーしてあります）</li>
        </ol>
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

// 本当にコピーできたときだけ true（https でないときなどは、予備の方法で試す）
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      ta.remove()
    }
  }
}

function ImageThumb({ blob, label }: { blob: Blob; label: string }) {
  const src = useBlobUrl(blob)
  return src ? <img className="reel-image" src={src} alt={label} /> : null
}
