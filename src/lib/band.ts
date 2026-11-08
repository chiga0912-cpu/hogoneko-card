import { loadImage, setDecor } from './card'

// 帯の柄（SPEC 3.1。11/6 作る人の決定）
// 作る人が用意した白黒（灰色）の画像を public/band.png に置くと、横・正方形の写真のカード・表紙・横の動画の帯に敷く。
// 置いていないとき・読めないときは null（今までどおり、テーマ色の無地）。画像は作る人の作品で、MITの対象外（README）
// 画像を1つ読む。ないとき・画像でないとき・読めないときは null
const fetchImg = (path: string): Promise<HTMLImageElement | null> =>
  fetch(path, { cache: 'no-cache' })
    .then((r) => {
      // 画像がないとき、公開先によっては 200 で画面のページ（HTML）が返るので、画像の種類かも確かめる
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return null
      return r.blob()
    })
    .then((b) => (b ? loadImage(b) : null))
    .catch(() => null)

// 作者の絵（11/8 作者の決定）も読んで、カードに入れる。置いていなければ描かない
// 最後の1枚の家は、粘土の家（house-clay）と平らな家（house-flat）のどちらかを作者が選ぶ（決まったら、もう一方は消す）
export const HOUSE_ART = '/art/house-clay.png'
let cached: Promise<HTMLImageElement | null> | null = null
export function loadBandPattern(): Promise<HTMLImageElement | null> {
  // 帯の柄はやめた（11/8 作者の決定。public/band.png も消した）。いつも null（テーマ色の無地）。柄を描く作りは card.ts に残っている
  cached ??= Promise.all([fetchImg('/art/clover.png'), fetchImg(HOUSE_ART), fetchImg('/art/flower.png'), fetchImg('/art/paw.png')]).then(([clover, house, flower, paw]) => {
    setDecor({ clover, house, flower, paw })
    return null
  })
  return cached
}
