// 1匹の紹介の順番（SPEC 3.2）に、カードと撮った動画を並べる
//   1 表紙 3秒 → 2 撮った動画（選んだ5秒。なければ飛ばす）→ 3 猫カード 3秒（言葉が2行なら4秒）→ 4 ひとこと 3〜5秒（なければ飛ばす）→ 5 最後の1枚 4秒
import type { AdoptionEvent, Cat, Shelter } from '../types'
import { bandColors, CARD_H, CARD_W, drawCatCard, drawClipName, drawCoverCard, drawEndCard, drawWordsCard, loadImage, paintBand } from './card'
import { cardWordLines } from './words'
import { loadBandPattern } from './band'
import { clipFrame, type Segment } from './video'
import { cardProfile } from './age'
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
  const pattern = await loadBandPattern() // 帯の柄（なければ null＝テーマ色の無地。SPEC 3.1）
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
  drawCoverCard(cover.getContext('2d')!, { photo: coverPhoto, logo, name: cat.name, theme: shelter.themeColor, shelterName: shelter.name, pattern })
  const catCard = canvas()
  const catLayout = drawCatCard(catCard.getContext('2d')!, {
    photo: catPhoto,
    logo,
    name: cat.name,
    profile: cardProfile(cat.age, cat.sex),
    lines: cardWordLines(cat.goodPoints, cat.cardLines), // 選んだ短い言葉の案があれば、その行だけ案に（#19）
    avoid: words?.trim() ? words : null,
    theme: shelter.themeColor,
    position: cat.textPosition,
    framing: cat.framing.cat,
    pattern,
  })
  const end = canvas()
  drawEndCard(end.getContext('2d')!, { logo, shelterName: shelter.name, contact: shelter.contact, event, theme: shelter.themeColor, photo: endPhoto, framing: cat.framing.end, pattern })

  // 横・正方形の動画の帯（黒をやめ、写真のカードと同じテーマ色・柄。SPEC 3.1。11/6 作者の決定）
  const { band, color: bandText } = bandColors(shelter.themeColor)
  const clipBand = canvas()
  paintBand(clipBand.getContext('2d')!, band, pattern)

  const segs: Segment[] = [{ kind: 'card', label: '表紙', sec: 3, image: cover }] // 表紙は3秒（11/5夜 作者の決定。SPEC 3.2）
  if (cat.clip)
    segs.push({
      kind: 'clip',
      label: '撮った動画',
      blob: cat.clip.blob,
      start: cat.clip.start,
      length: cat.clip.length,
      overlay: (ctx, area) => drawClipName(ctx, cat.name, area, { text: bandText, pattern: !!pattern }, cardProfile(cat.age, cat.sex)),
      background: clipBand,
    })
  // 言葉が2つなら5秒、1つなら4秒、なければ3秒（SPEC 3.2。11/6夜 作る人の決定）
  const catWords = catLayout.words.length
  segs.push({ kind: 'card', label: '猫カード', sec: catWords >= 2 ? 5 : catWords === 1 ? 4 : 3, image: catCard })
  if (words?.trim()) {
    const wc = canvas()
    // 秒数は行数で決める（1行3秒〜4行6秒。SPEC 3.2。11/6夜 作る人の決定）
    const wl = drawWordsCard(wc.getContext('2d')!, { text: words, theme: shelter.themeColor, photo: wordsPhoto, framing: cat.framing.words, pattern })
    segs.push({ kind: 'card', label: 'ひとこと', sec: wl.sec, image: wc })
  }
  segs.push({ kind: 'card', label: '最後の1枚', sec: 4, image: end })
  return segs
}
