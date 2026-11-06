// テーマ色を、アプリの画面の文字やボタンに使うときの「読める濃さ」（11/7 作者の指示）
// - 入力されたテーマ色そのもの・カードの帯は変えない。画面で使うときだけ、見やすさ4.5以上になるまで暗くする
// - text：地の色（--bg）や白の上に置く文字の色（団体名・見出し・［戻る］など）
// - strong：白い文字を載せる色（ボタン・選んだチップ・印など）

const BG = '#f6efe6' // 画面の地の色（index.css の --bg と同じ）
const lin = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const rgbOf = (hex: string) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
export const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
const hexOf = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

// 色を少しずつ黒に近づけて、相手の色との見やすさが4.5以上になった所の色（はじめから4.5以上なら、そのまま）
function darkenUntil(hex: string, against: string, target = 4.5): string {
  const base = rgbOf(hex)
  const other = rgbOf(against)
  for (let t = 0; t <= 1; t += 0.02) {
    const c = base.map((v) => v * (1 - t))
    if (contrast(c, other) >= target) return hexOf(c)
  }
  return '#000000'
}

export function themeInk(theme: string): { text: string; strong: string } {
  return { text: darkenUntil(theme, BG), strong: darkenUntil(theme, '#ffffff') }
}
