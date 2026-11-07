// 読み取った項目を、入力欄に入れる（SPEC 2.2）
// 入れるのは名前・性別・年齢・健康だけ。まだ入っていない項目にだけ入れる ⚙（スタッフさんが先に手で入れた内容を、黙って上書きしないため）
// 入れた項目には、メモから写した根拠を残す（「メモから」の印。押すと根拠が出る）
import type { Cat, CatField } from '../types'
import { birthGuess, type AgeHint, type Extracted } from './extract'
import { todayString } from './age'

export type Applied = { cat: Cat; filled: string[]; skipped: string[]; ageSuggestion: { hint: AgeHint; year: number; month: number } | null }

export function applyExtract(cat: Cat, x: Extracted): Applied {
  const filled: string[] = []
  const skipped: string[] = [] // メモにあったが、もう入っていたので入れなかった
  const sources: Partial<Record<CatField, string>> = { ...cat.sources }
  let c: Cat = { ...cat }
  if (x.name) {
    if (!c.name.trim()) {
      c.name = x.name.value.trim()
      sources.name = x.name.source
      filled.push('名前')
    } else if (c.name.trim() !== x.name.value.trim()) skipped.push('名前')
  }
  if (x.sex) {
    if (c.sex === '未確認') {
      c.sex = x.sex.value
      sources.sex = x.sex.source
      filled.push('性別')
    } else if (c.sex !== x.sex.value) skipped.push('性別')
  }
  let ageSuggestion: Applied['ageSuggestion'] = null
  if (x.age) {
    if (c.age.mode === 'unknown') {
      if (x.age.kind === 'stage' && x.age.stage) {
        c.age = { mode: 'stage', stage: x.age.stage }
        sources.age = x.age.source
        filled.push('年齢')
      } else {
        // 数から作る生まれた年月は、確かな生まれ月ではないので、入れずに案として出す（SPEC 4.2）
        const g = birthGuess(x.age)
        if (g) ageSuggestion = { hint: x.age, ...g }
      }
    } else skipped.push('年齢')
  }
  for (const [key, label] of [
    ['vaccine', 'ワクチン'],
    ['neuter', '不妊・去勢手術'],
    ['virusTest', '猫エイズ・白血病の検査'],
  ] as const) {
    const v = x[key]
    if (!v) continue
    if (c[key].value === '未確認') {
      // 「投稿文に載せる」は最初のまま（載せない）。人が選ぶ
      c = { ...c, [key]: { ...c[key], value: v.value }, healthCheckedAt: todayString() }
      sources[key] = v.source
      filled.push(label)
    } else if (c[key].value !== v.value) skipped.push(label)
  }
  // 「いいところ」と「ひとこと」は、人が書く欄なので入れない・書き換えない（11/7 作者の決定。SPEC 2.2）。
  // 読み取りの答えには入っているが（頼み方は変えていない）、ここで使わない
  c = { ...c, sources }
  return { cat: c, filled, skipped, ageSuggestion }
}
