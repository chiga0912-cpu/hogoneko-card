import type { AdoptionEvent } from '../types'

// 次の譲渡会：今日より前でない、いちばん近いもの（SPEC 3.2）
export function nextEvent(events: AdoptionEvent[], today = new Date()): AdoptionEvent | null {
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return events.filter((e) => e.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
}
