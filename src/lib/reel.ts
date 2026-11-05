// 1匹の紹介の順番（SPEC 3.2）に、カードと撮った動画を並べる
//   1 表紙 3秒 → 2 撮った動画（選んだ5秒。なければ飛ばす）→ 3 猫カード 3秒 → 4 ひとこと 3〜5秒（なければ飛ばす）→ 5 最後の1枚 4秒
import type { AdoptionEvent, Cat, Shelter } from '../types'
import { CARD_H, CARD_W, drawCatCard, drawClipName, drawCoverCard, drawEndCard, drawWordsCard, loadImage, wordsSec } from './card'
import { clipFrame, type Segment } from './video'
import { clipTimeFor, photoIndex, type CardKey } from './photoPlan'

const canvas = () => {
  const cv = document.createElement('canvas')
  cv.width = CARD_W
  cv.height = CARD_H
  return cv
}

// words：ひとことカードに載せる文（確認画面で決めたもの。入りきらず投稿文にだけ載せるときは null）
export async function buildSegments(cat: Cat, shelter: Shelter, event: AdoptionEvent | null, words: string | null): Promise<Segment[]> {
  // カードごとの写真（SPEC 3.2 の表）。写真がなく動画だけのときは、選んだ5秒のコマを使う
  const imgs = await Promise.all(cat.photos.map((b) => loadImage(b).catch(() => null)))
  const logo = shelter.logo ? await loadImage(shelter.logo).catch(() => null) : null
  const frames = new Map<CardKey, HTMLCanvasElement | null>()
  const pick = async (key: CardKey) => {
    const i = photoIndex(imgs.length, key)
    if (i !== null) return imgs[i] ?? imgs[0] ?? null
    if (!cat.clip) return null
    const t = clipTimeFor(cat.clip, key)
    if (!frames.has(key)) frames.set(key, await clipFrame(cat.clip.blob, t))
    return frames.get(key) ?? null
  }
  const coverPhoto = await pick('cover')
  const catPhoto = await pick('cat')
  const wordsPhoto = words?.trim() ? await pick('words') : null
  const endPhoto = await pick('end')

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
    framing: cat.framing.cat,
  })
  const end = canvas()
  drawEndCard(end.getContext('2d')!, { logo, shelterName: shelter.name, contact: shelter.contact, event, theme: shelter.themeColor, photo: endPhoto, framing: cat.framing.end })

  const segs: Segment[] = [{ kind: 'card', label: '表紙', sec: 3, image: cover }] // 表紙は3秒（11/5夜 作者の決定。SPEC 3.2）
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
  if (words?.trim()) {
    const wc = canvas()
    drawWordsCard(wc.getContext('2d')!, { text: words, logo, theme: shelter.themeColor, photo: wordsPhoto, framing: cat.framing.words })
    segs.push({ kind: 'card', label: 'ひとこと', sec: wordsSec(words), image: wc })
  }
  segs.push({ kind: 'card', label: '最後の1枚', sec: 4, image: end })
  return segs
}
