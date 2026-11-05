import { useEffect, useRef, useState } from 'react'
import type { Clip } from '../types'
import { useBlobUrl } from '../lib/useBlobUrls'

// 使う長さは5秒に決まっている。5秒より短い動画は全部使う（SPEC 2.2）
export const CLIP_SEC = 5
// 選べる動画の上限（#45）。とても大きい動画は、スマホの中で何度か写すと、iPhoneでページが落ちるおそれがあるため ⚙
// 200MB・3分は11/6朝に作者が決めた（SPEC 2.2）。1080pで1分ほどの動画は100MB前後
export const MAX_CLIP_BYTES = 200_000_000
export const MAX_CLIP_SEC = 180

// 超えたときの理由と、どうすればよいか（SPEC 2.2）
const WHY = 'スマホの中で動画を作るときに、止まってしまうことがあるためです。写真アプリの［編集］で、使いたい所の前後を切って短くしてから、もう一度選んでください。'

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

// 撮った動画を1本選び、つまみ1本で始まりを選ぶ。選んだ5秒をくり返し再生して見せる
export default function ClipPicker({ clip, onChange }: { clip: Clip | null; onChange: (c: Clip | null) => void }) {
  const url = useBlobUrl(clip?.blob ?? null)
  const ref = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false) // 読み込み中は、もう1本選べないようにする（見直し③の軽い9）

  const pick = async (file: File | undefined) => {
    if (!file) return
    // 中身を写す前に、大きさと長さを確かめる（大きすぎる動画を丸ごと写さないため。#45）
    if (file.size > MAX_CLIP_BYTES) {
      setNote(`この動画は大きすぎるため選べません（${Math.round(file.size / 1_000_000)}MB。${Math.round(MAX_CLIP_BYTES / 1_000_000)}MBまで）。${WHY}`)
      return
    }
    setNote('動画を読み込んでいます…')
    setBusy(true)
    try {
      // iPhoneでは選んだファイルが一時的な場所にあるので、すぐに中身を写す（大きさは上で確かめたので、写しても重すぎない）
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'video/mp4' })
      // 長さを確かめる。いつまでも分からないときは、待ちすぎずに読めなかったことにする（見直し③の中7）
      const d = await withTimeout(durationOf(blob), 8000)
      if (d > MAX_CLIP_SEC) {
        setNote(`この動画は長すぎるため選べません（${fmt(d)}。${MAX_CLIP_SEC / 60}分まで）。${WHY}`)
        return
      }
      onChange({ blob, start: 0, length: Math.min(CLIP_SEC, d) })
      setDuration(d)
      setNote('')
    } catch {
      setNote('動画を読み込めませんでした。別の動画を選んでください。')
    } finally {
      setBusy(false)
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
      {!clip && !busy && (
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, ng) => {
    const t = setTimeout(() => ng(new Error('時間切れ')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        ok(v)
      },
      (e) => {
        clearTimeout(t)
        ng(e)
      },
    )
  })
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
