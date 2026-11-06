import { loadImage } from './card'

// 帯の柄（SPEC 3.1。11/6 作る人の決定）
// 作る人が用意した白黒（灰色）の画像を public/band.png に置くと、横・正方形の写真のカード・表紙・横の動画の帯に敷く。
// 置いていないとき・読めないときは null（今までどおり、テーマ色の無地）。画像は作る人の作品で、MITの対象外（README）
let cached: Promise<HTMLImageElement | null> | null = null
export function loadBandPattern(): Promise<HTMLImageElement | null> {
  cached ??= fetch('/band.png', { cache: 'no-cache' })
    .then((r) => {
      // 画像がないとき、公開先によっては 200 で画面のページ（HTML）が返るので、画像の種類かも確かめる
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return null
      return r.blob()
    })
    .then((b) => (b ? loadImage(b) : null))
    .catch(() => null)
  return cached
}
