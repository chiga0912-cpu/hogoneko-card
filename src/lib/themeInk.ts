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

// ── 黄色の仲間を濃くするとき（11/7 作者の決定。iPhoneで明るい黄色がオリーブ色に見えたため）──
// 黄色をそのまま黒に近づけると、緑っぽい色（オリーブ色）になる。黄色の仲間だけ、少しオレンジ寄り（色相40°）にしながら暗くし、
// からし色・こげ茶に近い色にする。ほかの色は今までどおり。見やすさ4.5以上は同じ
const hslOf = ([r, g, b]: number[]): [number, number, number] => {
  const [x, y, z] = [r / 255, g / 255, b / 255]
  const mx = Math.max(x, y, z)
  const mn = Math.min(x, y, z)
  const l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === x ? (y - z) / d + (y < z ? 6 : 0) : mx === y ? (z - x) / d + 2 : (x - y) / d + 4
  return [h * 60, s, l]
}
const rgbOfHsl = ([h, s, l]: number[]) => {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255))
}
const YELLOW_FROM = 40 // 黄色の仲間とみなす色相（度）⚙。これより赤寄り（オレンジなど）は今までどおり
const YELLOW_TO = 72 // これより緑寄りは今までどおり ⚙
const YELLOW_INK_HUE = 40 // 濃くしたときの色相（少しオレンジ寄り。からし色）⚙
// 黄色の仲間で、相手の色との見やすさが足りないときだけ、からし色の方向へ暗くした色。それ以外は null（今までの暗くし方を使う）
export function yellowInk(hex: string, against: string, target = 4.5): string | null {
  const base = rgbOf(hex)
  const other = rgbOf(against)
  if (contrast(base, other) >= target) return null
  const [h, s, l] = hslOf(base)
  if (h < YELLOW_FROM || h > YELLOW_TO || s < 0.3) return null
  // 色相：62°までは40°に。62〜72°は、元の色相へ少しずつ戻す（境目で色が急に変わらないように）
  const hue = h <= 62 ? YELLOW_INK_HUE : YELLOW_INK_HUE + ((h - 62) / (YELLOW_TO - 62)) * (YELLOW_TO - YELLOW_INK_HUE)
  for (let t = 0; t <= 1; t += 0.01) {
    const c = rgbOfHsl([hue, s, l * (1 - t)])
    if (contrast(c, other) >= target) return hexOf(c)
  }
  return '#000000'
}

// 色を少しずつ黒に近づけて、相手の色との見やすさが4.5以上になった所の色（はじめから4.5以上なら、そのまま）
// 黄色の仲間だけは、からし色の方向へ暗くする（yellowInk）
function darkenUntil(hex: string, against: string, target = 4.5): string {
  const y = yellowInk(hex, against, target)
  if (y) return y
  const base = rgbOf(hex)
  const other = rgbOf(against)
  for (let t = 0; t <= 1; t += 0.02) {
    // 丸めた色で判定する（丸めた分だけ4.5を割らないように。#23のあとの見直しの中2）
    const c = base.map((v) => Math.round(v * (1 - t)))
    if (contrast(c, other) >= target) return hexOf(c)
  }
  return '#000000'
}

export function themeInk(theme: string): { text: string; strong: string } {
  return { text: darkenUntil(theme, BG), strong: darkenUntil(theme, '#ffffff') }
}
