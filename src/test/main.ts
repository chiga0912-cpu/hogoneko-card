// 動画テスト用のページ（本番の画面とは別。テストが終わったら公開から外す）
// 猫の写真は使わない。色をぬった仮のカードと仮の動画だけで試す
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncode,
} from 'mediabunny'

const W = 1080
const H = 1920
const FPS = 30
const THEME = '#e8826b'
const SAMPLE_POST = 'テスト投稿文です。\n#保護猫 #里親募集 #テスト'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const logEl = $<HTMLPreElement>('log')
const log = (s: string) => {
  logEl.textContent += s + '\n'
  console.log(s)
}
const setStatus = (id: string, s: string) => ($(id).textContent = s)
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + 'MB'
const sec = (ms: number) => (ms / 1000).toFixed(1) + '秒'

// ---- 端末の情報 ----
async function deviceInfo() {
  const mimes = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm']
  const recOk = typeof MediaRecorder !== 'undefined'
  log(`日時: ${new Date().toLocaleString('ja-JP')}`)
  log(`端末: ${navigator.userAgent}`)
  log(`録画(MediaRecorder): ${recOk ? 'あり' : 'なし'} / 対応形式: ${recOk ? mimes.filter((m) => MediaRecorder.isTypeSupported(m)).join(', ') || 'なし' : '-'}`)
  log(`1コマずつ(WebCodecs): ${'VideoEncoder' in window ? 'あり' : 'なし'} / H.264で作れる: ${await canEncode('avc').catch(() => false)}`)
  log(`共有(share): ${'share' in navigator ? 'あり' : 'なし'} / https: ${location.protocol === 'https:'}`)
  log('---')
}

// ---- 仮のカード（企画書の秒数どおり） ----
const CARDS = [
  { label: '表紙', sec: 2, color: '#c9a27e', big: 'テスト', small: 'ひざの上が大好き' },
  { label: '猫カード', sec: 3, color: '#8fa9a3', big: 'テスト', small: '推定2歳・オス\n毎朝、玄関までお迎えに来ます' },
  { label: 'ひとこと', sec: 4, color: '#f3e9d8', big: '', small: '「毎朝、玄関までお迎えに来てくれます。」\n— 預かりさんより' },
  { label: '最後の1枚', sec: 4, color: '#fff', big: 'テスト保護猫の会', small: '11月15日（日）13:00〜\nテスト会場\nInstagramのメッセージでどうぞ' },
]
const TOTAL = CARDS.reduce((s, c) => s + c.sec, 0)

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        lines.push(line)
        line = ch
      } else line += ch
    }
    lines.push(line)
  }
  return lines
}

// t = 0〜TOTAL 秒の時点の絵を描く
function drawCards(ctx: CanvasRenderingContext2D, t: number) {
  let start = 0
  let i = 0
  while (i < CARDS.length - 1 && t >= start + CARDS[i].sec) start += CARDS[i++].sec
  drawCard(ctx, CARDS[i], Math.min(1, (t - start) / CARDS[i].sec))
}

// カード1枚。p = 0〜1（そのカードの中での進み具合）
function drawCard(ctx: CanvasRenderingContext2D, c: (typeof CARDS)[number], p: number) {
  // 写真の代わり：ゆっくり大きくなる色の四角（写真の動きのテストも兼ねる）
  ctx.fillStyle = '#222'
  ctx.fillRect(0, 0, W, H)
  const z = 1 + 0.06 * p
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(z, z)
  ctx.fillStyle = c.color
  ctx.fillRect(-W / 2, -H / 2, W, H)
  ctx.fillStyle = 'rgba(0,0,0,.08)'
  for (let k = -6; k <= 6; k++) ctx.fillRect(k * 90 - 20, -H / 2, 40, H)
  ctx.restore()

  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(0,0,0,.25)'
  ctx.font = 'bold 64px sans-serif'
  ctx.fillText(`${c.label}（${c.sec}秒）`, W / 2, 220)

  // テーマ色の帯と文字（名前は中央寄り）
  ctx.fillStyle = THEME
  ctx.fillRect(0, 1180, W, 520)
  ctx.fillStyle = '#fff'
  if (c.big) {
    ctx.font = 'bold 120px sans-serif'
    ctx.fillText(c.big, W / 2, 1340)
  }
  ctx.font = '56px sans-serif'
  wrap(ctx, c.small, W - 160).forEach((line, k) => ctx.fillText(line, W / 2, (c.big ? 1440 : 1300) + k * 76))
}

// 動画の上に文字を重ねる
function drawOverlay(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 1200, 0, H)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,.6)')
  ctx.fillStyle = g
  ctx.fillRect(0, 1200, W, H - 1200)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 120px sans-serif'
  ctx.fillText('テスト', W / 2, 1560)
  ctx.font = '56px sans-serif'
  ctx.fillText('ひざの上が大好き', W / 2, 1660)
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number) {
  const s = Math.max(W / sw, H / sh)
  const dw = sw * s
  const dh = sh * s
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh)
}

function newCanvas() {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  return cv
}

// ---- 作り方① 録画する方法（MediaRecorder） ----
function pickMime() {
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm']) if (MediaRecorder.isTypeSupported(m)) return m
  return ''
}

async function recordCanvas(cv: HTMLCanvasElement, run: (stop: () => void) => void): Promise<Blob> {
  const mime = pickMime()
  const stream = cv.captureStream(FPS)
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<Blob>((ok) => (rec.onstop = () => ok(new Blob(chunks, { type: rec.mimeType || mime }))))
  rec.start(1000)
  run(() => rec.stop())
  const blob = await done
  stream.getTracks().forEach((t) => t.stop())
  return blob
}

let lastFrames: number | null = null

// ---- 作り方② 1コマずつ（WebCodecs＋mediabunny） ----
async function encodeFrames(cv: HTMLCanvasElement, frames: (add: (t: number) => Promise<void>) => Promise<void>) {
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const src = new CanvasSource(cv, { codec: 'avc', quality: QUALITY_HIGH })
  output.addVideoTrack(src, { frameRate: FPS })
  await output.start()
  let count = 0
  await frames((t) => {
    count++
    return src.add(t, 1 / FPS)
  })
  await output.finalize()
  lastFrames = count
  return new Blob([output.target.buffer!], { type: 'video/mp4' })
}

// ---- できた動画 ----
let result: { blob: Blob; name: string } | null = null
const runCount: Record<string, number> = {}
function showResult(blob: Blob, label: string, ms: number) {
  const ext = blob.type.includes('webm') ? 'webm' : 'mp4'
  result = { blob, name: `test-${Date.now()}.${ext}` }
  const n = (runCount[label] = (runCount[label] ?? 0) + 1)
  const v = $<HTMLVideoElement>('out')
  if (v.src) URL.revokeObjectURL(v.src)
  v.onloadedmetadata = () => log(`  できた動画の長さ ${v.duration.toFixed(1)}秒（${label} ${n}回目）`)
  v.src = URL.createObjectURL(blob)
  setStatus('out-label', `${label}（${n}回目）：${sec(ms)}・${mb(blob.size)}・${blob.type}`)
  const frames = lastFrames === null ? '' : ` / コマ数 ${lastFrames}`
  log(`${label}（${n}回目）: かかった時間 ${sec(ms)} / 大きさ ${mb(blob.size)} / 形式 ${blob.type}${frames}`)
  $<HTMLButtonElement>('c1').disabled = false
  $<HTMLButtonElement>('c2').disabled = false
}

async function runTest(statusId: string, label: string, fn: () => Promise<Blob>) {
  document.querySelectorAll('button').forEach((b) => (b.disabled = true))
  setStatus(statusId, '作っています…（画面を閉じないでください）')
  lastFrames = null
  const t0 = performance.now()
  try {
    const blob = await fn()
    const ms = performance.now() - t0
    setStatus(statusId, `できました（${sec(ms)}）`)
    showResult(blob, label, ms)
  } catch (e) {
    setStatus(statusId, `失敗：${(e as Error).message}`)
    log(`${label}: 失敗 ${(e as Error).name}: ${(e as Error).message}`)
  } finally {
    document.querySelectorAll('button').forEach((b) => (b.disabled = false))
    $<HTMLButtonElement>('c1').disabled = !result
    $<HTMLButtonElement>('c2').disabled = !result
    $<HTMLButtonElement>('b1').disabled = !source
    $<HTMLButtonElement>('b2').disabled = !source
  }
}

// A①
$('a1').onclick = () =>
  runTest('a-status', 'A①カード→録画', () => {
    const cv = newCanvas()
    const ctx = cv.getContext('2d')!
    drawCards(ctx, 0)
    return recordCanvas(cv, (stop) => {
      const t0 = performance.now()
      const tick = () => {
        const t = (performance.now() - t0) / 1000
        if (t >= TOTAL) return stop()
        drawCards(ctx, t)
        requestAnimationFrame(tick)
      }
      tick()
    })
  })

// A②
$('a2').onclick = () =>
  runTest('a-status', 'A②カード→1コマずつ', () => {
    const cv = newCanvas()
    const ctx = cv.getContext('2d')!
    return encodeFrames(cv, async (add) => {
      const n = TOTAL * FPS
      for (let f = 0; f < n; f++) {
        drawCards(ctx, f / FPS)
        await add(f / FPS)
        if (f % FPS === 0) setStatus('a-status', `作っています… ${Math.round((f / n) * 100)}%`)
      }
    })
  })

// ---- B. 動画に文字を重ねる ----
let source: File | null = null
const MAX_SEC = 15

function setSource(f: File, how: string) {
  source = f
  setStatus('b-source', `使う動画：${how}（${mb(f.size)}・${f.type || '形式不明'}）`)
  log(`B 元の動画: ${how} / ${mb(f.size)} / ${f.type}`)
  $<HTMLButtonElement>('b1').disabled = false
  $<HTMLButtonElement>('b2').disabled = false
}

$<HTMLInputElement>('b-file').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) setSource(f, '選んだ動画')
}

// 仮の動画：色が変わり、丸が動く5秒の縦動画
async function makeFake(hueStart = 0) {
  const cv = newCanvas()
  const ctx = cv.getContext('2d')!
  const blob = await encodeFrames(cv, async (add) => {
    for (let f = 0; f < 5 * FPS; f++) {
      const t = f / FPS
      ctx.fillStyle = `hsl(${(hueStart + t * 60) % 360} 50% 60%)`
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(W / 2 + Math.sin(t * 2) * 300, 700, 140, 0, Math.PI * 2)
      ctx.fill()
      await add(t)
    }
  })
  return new File([blob], 'fake.mp4', { type: 'video/mp4' })
}

$('b-fake').onclick = async () => {
  setStatus('b-source', '仮の動画を作っています…')
  try {
    setSource(await makeFake(), '仮の動画（プログラムで作成）')
  } catch (e) {
    setStatus('b-source', `仮の動画を作れませんでした：${(e as Error).message}`)
    log(`B 仮の動画: 失敗 ${(e as Error).message}`)
  }
}

// B① 再生しながら録画
$('b1').onclick = () =>
  runTest('b-status', 'B①動画に文字→録画', async () => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = URL.createObjectURL(source!)
    await video.play()
    const cv = newCanvas()
    const ctx = cv.getContext('2d')!
    try {
      return await recordCanvas(cv, (stop) => {
        const tick = () => {
          if (video.ended || video.currentTime >= MAX_SEC) {
            video.pause()
            return stop()
          }
          drawCover(ctx, video, video.videoWidth, video.videoHeight)
          drawOverlay(ctx)
          requestAnimationFrame(tick)
        }
        tick()
      })
    } finally {
      URL.revokeObjectURL(video.src)
    }
  })

// B② 1コマずつ読み出して重ねる
$('b2').onclick = () =>
  runTest('b-status', 'B②動画に文字→1コマずつ', async () => {
    const input = new Input({ source: new BlobSource(source!), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('動画が見つかりません')
    log(`B② 元の形式: ${track.codec} / ${track.displayWidth}×${track.displayHeight} / 回転 ${track.rotation}°`)
    if (!(await track.canDecode())) throw new Error(`この形式（${track.codec}）を読めません`)
    const sink = new CanvasSink(track, { width: W, height: H, fit: 'cover', poolSize: 2 })
    const cv = newCanvas()
    const ctx = cv.getContext('2d')!
    return encodeFrames(cv, async (add) => {
      for await (const frame of sink.canvases(0, MAX_SEC)) {
        ctx.drawImage(frame.canvas, 0, 0)
        drawOverlay(ctx)
        await add(frame.timestamp)
      }
    })
  })

// ---- D. カードと動画を1本につなぐ ----
const CLIP_SEC = 5
let dFiles: File[] = []
$<HTMLInputElement>('d-files').onchange = (e) => {
  dFiles = [...((e.target as HTMLInputElement).files ?? [])]
  setStatus('d-source', `選んだ動画：${dFiles.length}本（${dFiles.map((f) => mb(f.size)).join('・')}）`)
}

$('d1').onclick = () =>
  runTest('d-status', 'Dカード＋動画をつなぐ', async () => {
    const clips = dFiles.length ? dFiles : [await makeFake(0), await makeFake(180)]
    log(`D 動画の本数: ${clips.length}（${dFiles.length ? '選んだ動画' : '仮の動画'}）`)
    const cv = newCanvas()
    const ctx = cv.getContext('2d')!
    return encodeFrames(cv, async (add) => {
      let offset = 0
      // 表紙（2秒）
      for (let f = 0; f < CARDS[0].sec * FPS; f++) {
        drawCard(ctx, CARDS[0], f / (CARDS[0].sec * FPS))
        await add(offset + f / FPS)
      }
      offset += CARDS[0].sec

      // 動画を順に（1本5秒まで。30コマ/秒にそろえる）
      for (const [k, file] of clips.entries()) {
        setStatus('d-status', `動画${k + 1}本目をつないでいます…`)
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
        const track = await input.getPrimaryVideoTrack()
        if (!track) throw new Error(`${k + 1}本目に動画が見つかりません`)
        if (!(await track.canDecode())) throw new Error(`${k + 1}本目の形式（${track.codec}）を読めません`)
        const first = await track.getFirstTimestamp()
        const len = Math.min(CLIP_SEC, (await track.computeDuration()) - first)
        const tall = track.displayHeight >= track.displayWidth
        log(`D ${k + 1}本目: ${track.codec} / ${track.displayWidth}×${track.displayHeight} / 回転 ${track.rotation}° / 使う長さ ${len.toFixed(1)}秒 / ${tall ? '縦' : '横'}`)
        // 縦の動画は画面いっぱい、横の動画は上下に帯を付けて全体を見せる
        const sink = new CanvasSink(track, { width: W, height: H, fit: tall ? 'cover' : 'contain', poolSize: 2 })
        const n = Math.floor(len * FPS)
        const times = Array.from({ length: n }, (_, f) => first + f / FPS)
        let f = 0
        for await (const frame of sink.canvasesAtTimestamps(times)) {
          ctx.fillStyle = THEME
          ctx.fillRect(0, 0, W, H)
          if (frame) ctx.drawImage(frame.canvas, 0, 0)
          drawOverlay(ctx)
          await add(offset + f / FPS)
          f++
        }
        offset += n / FPS
      }

      // 最後のカード（4秒）
      const last = CARDS[CARDS.length - 1]
      for (let f = 0; f < last.sec * FPS; f++) {
        drawCard(ctx, last, f / (last.sec * FPS))
        await add(offset + f / FPS)
      }
    })
  })

// ---- C. 保存・Instagramへ ----
function resultFile() {
  return new File([result!.blob], result!.name, { type: result!.blob.type })
}

async function share(withCopy: boolean) {
  const file = resultFile()
  const label = withCopy ? 'C コピー＋共有' : 'C 共有'
  const can = navigator.canShare?.({ files: [file] }) ?? false
  // コピーは待たずに始める（共有はタップの直後でないと開けないため）
  const copying = withCopy ? navigator.clipboard.writeText(SAMPLE_POST).then(() => 'できた', (e) => `失敗(${e.name})`) : null
  try {
    await navigator.share({ files: [file] })
    setStatus('c-status', '共有の画面を閉じました')
    log(`${label}: canShare=${can} / 共有 完了`)
  } catch (e) {
    setStatus('c-status', `共有：${(e as Error).name}`)
    log(`${label}: canShare=${can} / 共有 ${(e as Error).name}: ${(e as Error).message}`)
  }
  if (copying) log(`${label}: 投稿文コピー ${await copying}`)
}
$('c1').onclick = () => share(false)
$('c2').onclick = () => share(true)
$('c3').onclick = () => {
  log('C Instagramを開く: 押した（開いたかは目で確認）')
  location.href = 'instagram://app'
}

$('copy-log').onclick = async () => {
  await navigator.clipboard.writeText(logEl.textContent ?? '')
  setStatus('c-status', '記録をコピーしました')
}

deviceInfo()
