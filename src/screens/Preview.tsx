import { useEffect, useRef, useState } from 'react'
import { MAX_HASHTAGS, type Cat, type Shelter } from '../types'
import { countHashtags } from '../lib/hashtags'
import { CARD_H, CARD_W, drawCatCard, loadImage, type CardLayout, type TextPosition } from '../lib/card'
import { TopBar } from './ShelterForm'

const POSITIONS: [TextPosition, string][] = [
  ['up', '少し上'],
  ['normal', 'ふつう'],
  ['down', '少し下'],
]

// 猫カード（SPEC 3.2 の3番目）。写真はスマホの中で描くだけ
function CatCard({
  cat,
  shelter,
  className,
  onLayout,
  onClick,
}: {
  cat: Cat
  shelter: Shelter
  className: string
  onLayout?: (l: CardLayout) => void
  onClick: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [layout, setLayout] = useState<CardLayout | null>(null)
  // 猫カードは写真の2枚目、なければ1枚目（SPEC 3.2）
  const photoBlob = cat.photos[1] ?? cat.photos[0] ?? null
  useEffect(() => {
    let stop = false
    ;(async () => {
      const [photo, logo] = await Promise.all([
        photoBlob ? loadImage(photoBlob).catch(() => null) : null,
        shelter.logo ? loadImage(shelter.logo).catch(() => null) : null,
      ])
      const ctx = ref.current?.getContext('2d')
      if (stop || !ctx) return
      const l = drawCatCard(ctx, {
        photo,
        logo,
        name: cat.name,
        lines: cat.goodPoints,
        theme: shelter.themeColor,
        position: cat.textPosition,
      })
      setLayout(l)
      onLayout?.(l)
    })()
    return () => {
      stop = true
    }
  }, [photoBlob, shelter.logo, shelter.themeColor, cat.name, cat.goodPoints, cat.textPosition, onLayout])
  return (
    <canvas
      ref={ref}
      width={CARD_W}
      height={CARD_H}
      className={className}
      onClick={onClick}
      data-drawn={layout ? '1' : '0'}
      data-fits={layout?.fits ? '1' : '0'}
      data-scale={layout?.scale}
      data-lines-shown={layout?.linesShown}
      data-lines-total={layout?.linesTotal}
      data-contrast={layout?.contrast}
      data-design={layout?.design}
      data-darken={layout?.darken}
      aria-label="猫カード（押すと画面いっぱいに出ます）"
    />
  )
}

type Props = {
  shelter: Shelter
  cat: Cat
  onCatChange: (update: (c: Cat) => Cat) => void
  post: string
  onPostChange: (s: string) => void
  onBack: () => void
  onSave: () => Promise<void>
}

// 確認（仮）。カードと根拠の印は11/5〜11/6に作る。今は決まった形の投稿文だけ
export default function Preview({ shelter, cat, onCatChange, post, onPostChange, onBack, onSave }: Props) {
  const [full, setFull] = useState(false)
  const [layout, setLayout] = useState<CardLayout | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const tagCount = countHashtags(post)
  const tooMany = tagCount > MAX_HASHTAGS
  return (
    <main className="screen">
      <TopBar title="確認（仮）" onBack={onBack} />
      <p className="note">猫カードを1枚だけ作りました。ほかのカードと動画は、これから作ります。</p>

      <section className="card-preview">
        <CatCard cat={cat} shelter={shelter} className="card-canvas" onLayout={setLayout} onClick={() => setFull(true)} />
        <p className="muted center">カードを押すと、画面いっぱいに出ます</p>
        {layout && layout.linesShown < layout.linesTotal && (
          <p className="notice">
            いいところが長くて入りきらないので、最初の{layout.linesShown}行だけ載せました（行の途中では切っていません）。
          </p>
        )}
        {layout && layout.linesShown === layout.linesTotal && layout.scale < 1 && (
          <p className="notice">いいところが長いので、カードの文字を少し小さくしました。</p>
        )}
        {layout && !layout.fits && <p className="alert">名前が長くて、カードに入りきりません。</p>}

        {layout?.design === 'B' && <p className="muted center">横長・正方形の写真なので、文字は上下の色の帯に入ります</p>}
        {layout?.design !== 'B' && (
        <div className="choices" role="group" aria-label="文字の位置">
          {POSITIONS.map(([v, label]) => (
            <button
              key={v}
              className={`chip ${cat.textPosition === v ? 'chip-on' : ''}`}
              onClick={() => onCatChange((c) => ({ ...c, textPosition: v }))}
            >
              {label}
            </button>
          ))}
        </div>
        )}
      </section>

      {full && (
        <div className="card-full" role="dialog" aria-label="猫カードを画面いっぱいに表示" onClick={() => setFull(false)}>
          <CatCard cat={cat} shelter={shelter} className="card-full-canvas" onClick={() => setFull(false)} />
          <button className="card-close" onClick={() => setFull(false)}>
            × 閉じる
          </button>
          <p className="card-full-hint">画面のどこを押しても閉じます</p>
        </div>
      )}

      {shelter.hashtags.length > MAX_HASHTAGS && (
        <p className="notice">
          ハッシュタグが{shelter.hashtags.length}こ登録されています。投稿文には最初の{MAX_HASHTAGS}こだけ入れました。
        </p>
      )}

      {tooMany && (
        <p className="alert">
          投稿文にハッシュタグが{tagCount}こあります。1投稿{MAX_HASHTAGS}こまでです。減らすと先へ進めます。
        </p>
      )}

      <label className="field">
        <span>投稿文（その場で直せます）</span>
        <textarea rows={14} value={post} onChange={(e) => onPostChange(e.target.value)} />
        <small className="muted">入れた項目を決まった形に並べた文章です。AIで整えるのは次の段階です</small>
      </label>

      <div className="bottom-bar">
        {/* 押した場所のすぐ上に出す（スクロールしなくても見えるように） */}
        {saveFailed && <p className="alert bar-alert">名簿に保存できませんでした。もう一度押してください。</p>}
        <button
          className="btn btn-primary btn-big"
          disabled={saving || tooMany}
          onClick={async () => {
            setSaving(true)
            setSaveFailed(false)
            try {
              await onSave()
            } catch {
              setSaveFailed(true)
              setSaving(false)
            }
          }}
        >
          名簿に保存する
        </button>
      </div>
    </main>
  )
}
