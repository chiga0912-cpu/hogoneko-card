// ロゴを丸いアイコンにする（Instagramのアイコンと同じ。11/7 作る人の決定。SPEC 3.1）
// - どの画像も、丸い枠で真ん中をそのまま切り取るだけ（正方形・縦長・横長で作りを変えない。白い余白も詰めない）
// - 背景が透明なロゴは、テーマ色の丸の上に出す（暗い写真の上でも見えるように）
// - 画面もカードも、ロゴの下に白い台を足さない

export type Img = CanvasImageSource & { width: number; height: number }

// 背景が透明なロゴか（透明な所が少しでもあれば透明とみなす）。調べられないときは透明でないとみなす
const clearCache = new WeakMap<object, boolean>()
export function logoHasClear(img: Img): boolean {
  const known = clearCache.get(img)
  if (known !== undefined) return known
  let clear = false
  try {
    const c = document.createElement('canvas')
    c.width = 48
    c.height = 48
    const x = c.getContext('2d', { willReadFrequently: true })
    if (x) {
      x.drawImage(img, 0, 0, 48, 48)
      const d = x.getImageData(0, 0, 48, 48).data
      for (let i = 3; i < d.length; i += 4)
        if (d[i] < 250) {
          clear = true
          break
        }
    }
  } catch {
    clear = false
  }
  clearCache.set(img, clear)
  return clear
}

// 丸いアイコンを描く。x, y：丸を囲む四角の左上。d：丸の直径。theme：透明なロゴの下に敷く色
export function drawLogoCircle(ctx: CanvasRenderingContext2D, img: Img, x: number, y: number, d: number, theme: string) {
  const s = d / Math.min(img.width, img.height)
  const dw = img.width * s
  const dh = img.height * s
  ctx.save()
  ctx.beginPath()
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  if (logoHasClear(img)) {
    ctx.fillStyle = theme
    ctx.fillRect(x, y, d, d)
  }
  ctx.drawImage(img, x + (d - dw) / 2, y + (d - dh) / 2, dw, dh)
  ctx.restore()
}
