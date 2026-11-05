import { useEffect, useRef, useState } from 'react'
import type { Clip } from '../types'
import { useBlobUrl } from '../lib/useBlobUrls'

// 使う長さは5秒に決まっている。5秒より短い動画は全部使う（SPEC 2.2）
export const CLIP_SEC = 5

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

// 撮った動画を1本選び、つまみ1本で始まりを選ぶ。選んだ5秒をくり返し再生して見せる
export default function ClipPicker({ clip, onChange }: { clip: Clip | null; onChange: (c: Clip | null) => void }) {
  const url = useBlobUrl(clip?.blob ?? null)
  const ref = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const pick = async (file: File | undefined) => {
    if (!file) return
    setNote('動画を読み込んでいます…')
    try {
      // iPhoneでは選んだファイルが一時的な場所にあるので、すぐに中身を写す
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'video/mp4' })
      const d = await durationOf(blob)
      onChange({ blob, start: 0, length: Math.min(CLIP_SEC, d) })
      setDuration(d)
      setNote('')
    } catch {
      setNote('動画を読み込めませんでした。別の動画を選んでください。')
    }
  }

  // 選んだ5秒だけを、くり返し再生する
  useEffect(() => {
    const v = ref.current
    if (!v || !clip) return
    const loop = () => {
      if (v.currentTime < clip.start || v.currentTime >= clip.start + clip.length - 0.05) v.currentTime = clip.start
    }
    const onMeta = () => {
      if (Number.isFinite(v.duration)) setDuration(v.duration)
      v.currentTime = clip.start
      void v.play().catch(() => {})
    }
    v.addEventListener('timeupdate', loop)
    v.addEventListener('loadedmetadata', onMeta)
    if (v.readyState >= 1) {
      v.currentTime = clip.start
      void v.play().catch(() => {})
    }
    return () => {
      v.removeEventListener('timeupdate', loop)
      v.removeEventListener('loadedmetadata', onMeta)
    }
  }, [clip])

  const maxStart = duration ? Math.max(0, duration - (clip?.length ?? CLIP_SEC)) : 0

  return (
    <div className="field clip-field">
      <span>動画（1本まで・使うのは5秒）</span>
      {!clip && (
        <label className="btn btn-big clip-add">
          ＋ 動画を選ぶ
          <input
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      )}
      {clip && url && (
        <>
          <video ref={ref} className="clip-video" src={url} muted playsInline autoPlay aria-label="選んだ5秒をくり返し再生しています" />
          {maxStart > 0 ? (
            <label className="clip-range">
              <span className="muted">つまみを動かして、使う5秒の始まりを選んでください</span>
              <input
                type="range"
                min={0}
                max={maxStart}
                step={0.1}
                value={Math.min(clip.start, maxStart)}
                aria-label="使う5秒の始まり"
                onChange={(e) => onChange({ ...clip, start: Number(e.target.value) })}
              />
            </label>
          ) : (
            <p className="muted">{duration !== null && '5秒より短い動画なので、全部使います。'}</p>
          )}
          <p className="muted clip-time" data-start={clip.start} data-length={clip.length}>
            {fmt(clip.start)}〜{fmt(clip.start + clip.length)} を使います（{clip.length.toFixed(1)}秒）
          </p>
          <button className="btn btn-ghost" onClick={() => onChange(null)}>
            動画を外す
          </button>
        </>
      )}
      {note && <p className="notice">{note}</p>}
    </div>
  )
}

function durationOf(blob: Blob): Promise<number> {
  return new Promise((ok, ng) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const u = URL.createObjectURL(blob)
    const done = (f: () => void) => {
      URL.revokeObjectURL(u)
      f()
    }
    v.onloadedmetadata = () => {
      // 長さが分からない動画（Infinity）は、少し先まで読ませて求める
      if (Number.isFinite(v.duration) && v.duration > 0) done(() => ok(v.duration))
      else {
        v.ontimeupdate = () => {
          v.ontimeupdate = null
          done(() => (Number.isFinite(v.duration) ? ok(v.duration) : ng(new Error('長さが分かりません'))))
        }
        v.currentTime = 1e9
      }
    }
    v.onerror = () => done(() => ng(new Error('動画を読めません')))
    v.src = u
  })
}
