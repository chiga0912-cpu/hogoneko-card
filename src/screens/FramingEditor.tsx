import { useEffect, useRef, useState } from 'react'
import { CARD_H, CARD_W, MAX_SCALE, type Framing } from '../lib/card'

// 写真を指で動かす画面（SPEC 2.4・issue #29）。1本指で動かし、2本指で広げると大きく、つまむと小さくなる。
// ボタンでも大きく・小さくできる（2本指が使いにくい人のため ⚙）。Claudeは写真を見ない。合わせるのは人
type Props = {
  title: string
  initial: Framing | undefined
  // 位置を受け取ってカードを描き、実際に使った位置（はみ出さないように止めた値）を返す
  paint: (ctx: CanvasRenderingContext2D, f: Framing) => Promise<Framing | null>
  onDone: (f: Framing | null) => void // null＝もとに戻した
  onCancel: () => void
}

const START: Framing = { x: 0, y: 0, scale: 1 }

export default function FramingEditor({ title, initial, paint, onDone, onCancel }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [f, setF] = useState<Framing>(initial ?? START)
  const used = useRef<Framing>(initial ?? START)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drawing = useRef(false)
  const pending = useRef<Framing | null>(null)

  // 描く（指の動きが速くても、描き終わってから次を描く）
  useEffect(() => {
    pending.current = f
    if (drawing.current) return
    const run = async () => {
      drawing.current = true
      while (pending.current) {
        const want = pending.current
        pending.current = null
        const ctx = ref.current?.getContext('2d')
        if (!ctx) break
        const got = await paint(ctx, want)
        if (got) used.current = got
      }
      drawing.current = false
    }
    void run()
  }, [f, paint])

  // 画面の上の1ピクセルが、カードの何ピクセルか
  const ratio = () => CARD_W / (ref.current?.getBoundingClientRect().width || CARD_W)

  const onDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const pts = [...pointers.current.entries()]
    if (pts.length >= 2) {
      // 2本指：指と指の間の長さの変わり方で、大きさを変える
      const other = pts.find(([id]) => id !== e.pointerId)![1]
      const before = Math.hypot(prev.x - other.x, prev.y - other.y)
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      if (before > 10) setF((c) => ({ ...used.current, scale: Math.min(MAX_SCALE, Math.max(1, c.scale * (after / before))) }))
    } else {
      // 1本指：動かした分だけ写真を動かす（止まっている所から動かせるように、実際に使った位置から足す）
      const r = ratio()
      const dx = (e.clientX - prev.x) * r
      const dy = (e.clientY - prev.y) * r
      setF(() => ({ ...used.current, x: used.current.x + dx, y: used.current.y + dy }))
      used.current = { ...used.current, x: used.current.x + dx, y: used.current.y + dy }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
  }
  const zoom = (by: number) => setF(() => ({ ...used.current, scale: Math.min(MAX_SCALE, Math.max(1, used.current.scale + by)) }))

  return (
    <div className="framing" role="dialog" aria-label={`${title}の写真の位置を直す`}>
      <p className="framing-hint">指で写真を動かして、猫の顔が見えるように合わせてください。2本の指で広げると大きくなります</p>
      <canvas
        ref={ref}
        width={CARD_W}
        height={CARD_H}
        className="framing-canvas"
        data-x={Math.round(f.x)}
        data-y={Math.round(f.y)}
        data-scale={f.scale.toFixed(2)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-label="写真を動かせるカード"
      />
      <div className="framing-bar">
        <button className="btn" onClick={() => zoom(-0.2)} disabled={f.scale <= 1}>
          小さく
        </button>
        <button className="btn" onClick={() => zoom(0.2)} disabled={f.scale >= MAX_SCALE}>
          大きく
        </button>
        <button className="btn" onClick={() => setF(START)}>
          もとに戻す
        </button>
      </div>
      <div className="framing-bar">
        <button className="btn btn-ghost" onClick={onCancel}>
          やめる
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            const u = used.current
            const isStart = Math.abs(u.x) < 1 && Math.abs(u.y) < 1 && u.scale <= 1.001
            onDone(isStart ? null : { x: Math.round(u.x), y: Math.round(u.y), scale: Math.round(u.scale * 100) / 100 })
          }}
        >
          この位置にする
        </button>
      </div>
    </div>
  )
}

