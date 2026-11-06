import type { Age } from '../types'

// 今日の時点の月齢（生まれた月を0か月とする）
export function monthsOld(age: Age, today = new Date()): number | null {
  if (age.mode !== 'birth' || !age.birthYear || !age.birthMonth) return null
  const m = (today.getFullYear() - age.birthYear) * 12 + (today.getMonth() + 1 - age.birthMonth)
  return m < 0 ? null : m
}

// カードや投稿文に出す年齢の言葉。「不明」のときは空（年齢を書かない）
export function ageText(age: Age, today = new Date()): string {
  if (age.mode === 'stage') return age.stage ?? ''
  if (age.mode !== 'birth') return ''
  const m = monthsOld(age, today)
  if (m === null) return ''
  const pre = age.estimated ? '推定' : ''
  if (m < 12) return `${pre}生後${m}か月`
  const y = Math.floor(m / 12)
  const rest = m % 12
  return `${pre}${y}歳${y < 2 && rest ? `${rest}か月` : ''}`
}

// <input type="month"> の値（"2026-09"）との行き来
export const toMonthValue = (age: Age) =>
  age.birthYear && age.birthMonth ? `${age.birthYear}-${String(age.birthMonth).padStart(2, '0')}` : ''

export function fromMonthValue(v: string): Pick<Age, 'birthYear' | 'birthMonth'> {
  const m = /^(\d{4})-(\d{2})$/.exec(v)
  return m ? { birthYear: Number(m[1]), birthMonth: Number(m[2]) } : { birthYear: undefined, birthMonth: undefined }
}

export const todayString = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function jpDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${Number(m[2])}月${Number(m[3])}日` : ymd
}

// 猫カードの、名前の下の1行（例「推定2歳・男の子」）。不明な項目は出さない。両方不明なら空（SPEC 3.1。11/6 作る人の決定）
export function cardProfile(age: Age, sex: string, today = new Date()): string {
  const s = sex === 'オス' ? '男の子' : sex === 'メス' ? '女の子' : ''
  return [ageText(age, today), s].filter(Boolean).join('・')
}
