import type { Cat, Shelter } from '../types'
import { ageText } from './age'
import { limitHashtags } from './hashtags'

// 決まった形の投稿文（AIを使わない）。SPEC 4.4
// 物語の本文は、Claudeを入れるまでは人が書く
export function makeFixedPost(cat: Cat, shelter: Shelter, today = new Date()): string {
  const blocks: string[][] = []

  const profile = [ageText(cat.age, today), cat.sex !== '未確認' ? cat.sex : ''].filter(Boolean).join('・')
  blocks.push([`【${cat.name.trim()}】`, ...(profile ? [profile] : [])])

  const points = cat.goodPoints.map((p) => p.trim()).filter(Boolean)
  if (points.length) blocks.push(points.map((p) => `・${p}`))

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
