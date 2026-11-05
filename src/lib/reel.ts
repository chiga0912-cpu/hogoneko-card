// 1匹の紹介の順番（SPEC 3.2）に、カードと撮った動画を並べる
//   1 表紙 2秒 → 2 撮った動画（選んだ5秒。なければ飛ばす）→ 3 猫カード 3秒 → 4 ひとこと（これから作る）→ 5 最後の1枚 4秒
import type { AdoptionEvent, Cat, Shelter } from '../types'
import { CARD_H, CARD_W, drawCatCard, drawClipName, drawCoverCard, drawEndCard, loadImage } from './card'
import { clipFrame, type Segment } from './video'

const canvas = () => {
  const cv = document.createElement('canvas')
  cv.width = CARD_W
  cv.height = CARD_H
  return cv
}

export async function buildSegments(cat: Cat, shelter: Shelter, event: AdoptionEvent | null): Promise<Segment[]> {
  const [p1, p2, logo] = await Promise.all([
    cat.photos[0] ? loadImage(cat.photos[0]).catch(() => null) : null,
    cat.photos[1] ? loadImage(cat.photos[1]).catch(() => null) : null,
    shelter.logo ? loadImage(shelter.logo).catch(() => null) : null,
  ])
  // 写真がなく動画だけのときは、表紙と猫カードに、選んだ5秒の最初のコマを使う（SPEC 3.2）
  const still = !p1 && cat.clip ? await clipFrame(cat.clip.blob, cat.clip.start) : null
  const coverPhoto = p1 ?? still
  const catPhoto = p2 ?? p1 ?? still

  const cover = canvas()
  drawCoverCard(cover.getContext('2d')!, { photo: coverPhoto, logo, name: cat.name, theme: shelter.themeColor })
  const catCard = canvas()
  drawCatCard(catCard.getContext('2d')!, {
    photo: catPhoto,
    logo,
    name: cat.name,
    lines: cat.goodPoints,
    theme: shelter.themeColor,
    position: cat.textPosition,
  })
  const end = canvas()
  drawEndCard(end.getContext('2d')!, { logo, shelterName: shelter.name, contact: shelter.contact, event, theme: shelter.themeColor })

  const segs: Segment[] = [{ kind: 'card', label: '表紙', sec: 2, image: cover }]
  if (cat.clip)
    segs.push({
      kind: 'clip',
      label: '撮った動画',
      blob: cat.clip.blob,
      start: cat.clip.start,
      length: cat.clip.length,
      overlay: (ctx) => drawClipName(ctx, cat.name),
    })
  segs.push({ kind: 'card', label: '猫カード', sec: 3, image: catCard })
  segs.push({ kind: 'card', label: '最後の1枚', sec: 4, image: end })
  return segs
}
