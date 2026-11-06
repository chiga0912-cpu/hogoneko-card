import type { Cat, Shelter } from '../types'
import { ageText } from './age'
import { limitHashtags } from './hashtags'
import { closingLine, countEmoji, POST_EMOJI_MAX, tidyEmoji } from './story'

// 決まった形の投稿文（AIを使わない）。SPEC 4.4
// story：Claudeが書いた物語の本文（#16）。あるときは「いいところ」の箇条書きの代わりに入れる（本文がいいところを元に書くため）
// ないとき（Claudeが使えない・使わない）は、今までどおり決まった形だけ（SPEC 4.4）
export function makeFixedPost(cat: Cat, shelter: Shelter, today = new Date(), story?: string): string {
  const blocks: string[][] = []

  const profile = [ageText(cat.age, today), cat.sex !== '未確認' ? cat.sex : ''].filter(Boolean).join('・')
  blocks.push([`【${cat.name.trim()}】`, ...(profile ? [profile] : [])])

  const points = cat.goodPoints.map((p) => p.trim()).filter(Boolean)
  // 絵文字は、決まった文も含めて2つまで。決まった文の絵文字は消さず、本文の後ろから消す（SPEC 4.2。11/7 作者の決定）
  const closing = closingLine(cat.name, cat.id)
  const body = story ? tidyEmoji(story, Math.max(0, POST_EMOJI_MAX - countEmoji(closing))) : ''
  // 本文のあとに決まった文を足す（Claudeには書かせない。根拠の確認の対象にしない。人が消したり直したりできる。SPEC 4.2）
  if (body) blocks.push([...body.split('\n').map((l) => l.trim()).filter(Boolean), closing])
  else if (points.length) blocks.push(points.map((p) => `・${p}`))

  if (cat.carerWords.trim()) blocks.push(['＜ひとこと＞', `「${cat.carerWords}」`])

  const health = [
    cat.vaccine.show && cat.vaccine.value !== '未確認' && `ワクチン：${cat.vaccine.value}`,
    cat.neuter.show && cat.neuter.value !== '未確認' && `不妊・去勢手術：${cat.neuter.value}`,
    cat.virusTest.show && cat.virusTest.value !== '未確認' && `猫エイズ・白血病の検査：${cat.virusTest.value}`,
  ].filter((x): x is string => Boolean(x))
  if (health.length) blocks.push(health)

  if (shelter.fixedText.trim()) blocks.push([shelter.fixedText.trim()])
  if (shelter.contact.trim()) blocks.push([`お問い合わせ：${shelter.contact.trim()}`])

  const tags = limitHashtags(shelter.hashtags)
  if (tags.length) blocks.push([tags.join(' ')])

  return blocks.map((b) => b.join('\n')).join('\n\n')
}
