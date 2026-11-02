import type { Cat, Shelter } from './types'

// 仮の投稿文。入力された言葉を並べるだけ（AIは11/4に入れる）
export function makeDraftPost(cat: Cat, shelter: Shelter): string {
  const lines: string[] = []
  lines.push(`【${cat.name}】${cat.age}・${cat.sex}`)
  lines.push(cat.personality)
  if (cat.rescueStory) lines.push('', cat.rescueStory)
  if (cat.nowStory) lines.push('', cat.nowStory)
  if (cat.carerWords) lines.push('', `預かりさんより：「${cat.carerWords}」`)

  const health = [
    cat.vaccine.value && `ワクチン：${cat.vaccine.value}`,
    cat.neuter.value && `不妊・去勢手術：${cat.neuter.value}`,
    cat.virusTest.value && `猫エイズ・白血病の検査：${cat.virusTest.value}`,
  ].filter(Boolean)
  if (health.length) lines.push('', ...health)

  if (shelter.fixedText) lines.push('', shelter.fixedText)
  if (shelter.contact) lines.push('', `お問い合わせ：${shelter.contact}`)
  if (shelter.hashtags) lines.push('', shelter.hashtags)
  return lines.join('\n')
}
