import { useEffect, useRef, useState } from 'react'
import { MAX_HASHTAGS, type AdoptionEvent, type Cat, type Shelter } from '../types'
import { countHashtags } from '../lib/hashtags'
import {
  CARD_H,
  CARD_W,
  drawCatCard,
  drawCoverCard,
  drawEndCard,
  loadImage,
  type CardLayout,
  type TextPosition,
} from '../lib/card'
import * as db from '../db'
import { nextEvent } from '../lib/events'
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

// 表紙・最後の1枚（写真はスマホの中で描くだけ）
type Painter = (ctx: CanvasRenderingContext2D) => Promise<Record<string, string | number | boolean>>
function PaintedCard({ paint, deps, className, label, onClick }: { paint: Painter; deps: unknown[]; className: string; label: string; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [info, setInfo] = useState<Record<string, string | number | boolean> | null>(null)
  useEffect(() => {
    let stop = false
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    paint(ctx).then((i) => {
      if (!stop) setInfo(i)
    })
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  const data = Object.fromEntries(Object.entries(info ?? {}).map(([k, v]) => [`data-${k}`, String(v === true ? 1 : v === false ? 0 : v)]))
  return <canvas ref={ref} width={CARD_W} height={CARD_H} className={className} onClick={onClick} data-drawn={info ? '1' : '0'} {...data} aria-label={label} />
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
  const [full, setFull] = useState<'cover' | 'cat' | 'end' | null>(null)
  const [layout, setLayout] = useState<CardLayout | null>(null)
  const [event, setEvent] = useState<AdoptionEvent | null>(null)
  const [showEvent, setShowEvent] = useState(true) // 最後の1枚に譲渡会を入れるか（確認画面で外せる）
  useEffect(() => {
    db.loadEvents().then(
      (list) => setEvent(nextEvent(list)),
      () => setEvent(null), // 読めなくても、連絡先だけで作れる
    )
  }, [])
  const photo1 = cat.photos[0] ?? null
  const paintCover: Painter = async (ctx) => {
    const [photo, logo] = await Promise.all([
      photo1 ? loadImage(photo1).catch(() => null) : null,
      shelter.logo ? loadImage(shelter.logo).catch(() => null) : null,
    ])
    const l = drawCoverCard(ctx, { photo, logo, name: cat.name, theme: shelter.themeColor })
    return { fits: l.fits, design: l.design, contrast: l.contrast }
  }
  const usedEvent = showEvent ? event : null
  const paintEnd: Painter = async (ctx) => {
    const logo = shelter.logo ? await loadImage(shelter.logo).catch(() => null) : null
    const l = drawEndCard(ctx, { logo, shelterName: shelter.name, contact: shelter.contact, event: usedEvent, theme: shelter.themeColor })
    return { fits: l.fits, scale: l.scale, event: l.hasEvent }
  }
  const coverDeps = [photo1, shelter.logo, shelter.themeColor, cat.name]
  const endDeps = [shelter.logo, shelter.name, shelter.contact, shelter.themeColor, usedEvent]
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const tagCount = countHashtags(post)
  const tooMany = tagCount > MAX_HASHTAGS
  return (
    <main className="screen">
      <TopBar title="確認（仮）" onBack={onBack} />
      <p className="note">表紙・猫カード・最後の1枚を作りました。撮った動画とひとことカードは、これから作ります。</p>

      <section className="card-preview">
        {/* 横にめくって全部見られる（SPEC 2.4） */}
        <div className="card-strip" aria-label="カード（横にめくれます）">
          <figure className="card-slot">
            <PaintedCard paint={paintCover} deps={coverDeps} className="card-thumb card-cover" label="表紙（押すと画面いっぱいに出ます）" onClick={() => setFull('cover')} />
            <figcaption>1 表紙</figcaption>
          </figure>
          <figure className="card-slot">
            <CatCard cat={cat} shelter={shelter} className="card-canvas" onLayout={setLayout} onClick={() => setFull('cat')} />
            <figcaption>2 猫カード</figcaption>
          </figure>
          <figure className="card-slot">
            <PaintedCard paint={paintEnd} deps={endDeps} className="card-thumb card-end" label="最後の1枚（押すと画面いっぱいに出ます）" onClick={() => setFull('end')} />
            <figcaption>3 最後の1枚</figcaption>
          </figure>
        </div>
        <p className="muted center">横にめくると、ほかのカードが見られます。カードを押すと、画面いっぱいに出ます</p>
        {layout && layout.linesShown < layout.linesTotal && (
          <p className="notice">
            いいところが長くて入りきらないので、最初の{layout.linesShown}行だけ載せました（行の途中では切っていません）。
          </p>
        )}
        {layout && layout.linesTotal > 0 && layout.linesShown === layout.linesTotal && layout.scale < 1 && (
          <p className="notice">いいところが長いので、カードの文字を少し小さくしました。</p>
        )}
        {layout && !layout.fits && <p className="alert">名前が長くて、カードに入りきりません。</p>}

        {layout?.design === 'B' && (
          <p className="muted center">横長・正方形の写真なので、文字は上下の色の帯に入ります。縦長の写真なら、写真の上に文字が載ります</p>
        )}
        {/* カードを描き終わってから出す（開いた直後に、案Bでも一瞬出てしまわないように） */}
        {layout?.design === 'A' && (
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

      {event && (
        <label className="check-row">
          <input type="checkbox" checked={showEvent} onChange={(e) => setShowEvent(e.target.checked)} />
          最後の1枚に、次の譲渡会（{event.date.slice(5).replace('-', '/')}）を入れる
        </label>
      )}
      {!event && <p className="muted">次の譲渡会が登録されていないので、最後の1枚には団体名と連絡先だけを入れます。</p>}

      {full && (
        <div className="card-full" role="dialog" aria-label="カードを画面いっぱいに表示" onClick={() => setFull(null)}>
          {full === 'cat' && <CatCard cat={cat} shelter={shelter} className="card-full-canvas" onClick={() => setFull(null)} />}
          {full === 'cover' && <PaintedCard paint={paintCover} deps={coverDeps} className="card-full-canvas" label="表紙" onClick={() => setFull(null)} />}
          {full === 'end' && <PaintedCard paint={paintEnd} deps={endDeps} className="card-full-canvas" label="最後の1枚" onClick={() => setFull(null)} />}
          <button className="card-close" onClick={() => setFull(null)}>
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
