// テーマ色と、その上・そのまわりの文字の色（11/8 作者の決定）
// - 選んだテーマ色は、変えずにそのまま使う（ボタン・選んだチップ・印・カードの帯・動画の帯）。「選んだ色と違う」とならないように
// - テーマ色の上の文字（on）は、白か濃い色の読みやすいほう。濃い色は画面の文字の色（index.css の --text）。
//   どちらも見やすさ4.5に届かない中くらいの色だけ、黒にする（白か黒のどちらかは、いつも4.5以上になる）
// - 地の色（--bg）の上にテーマ色で書く文字（text：団体名・見出し・［戻る］など）は、読めるならテーマ色のまま、読めなければ画面の文字の色
// （11/7 までの「テーマ色を暗くして使う」やり方と、黄色をからし色にする直しは、やめた）

const BG = '#f6efe6' // 画面の地の色（index.css の --bg と同じ）
export const DARK_TEXT = '#3b2f2a' // 画面の文字の色（index.css の --text と同じ）
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
// 色の書き方をそろえる（#abc や大文字でも、#aabbcc の形に）
const norm = (hex: string) => '#' + rgbOf(hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex).map((v) => v.toString(16).padStart(2, '0')).join('')

// テーマ色の上に置く文字の色
export function onTheme(theme: string): string {
  const t = rgbOf(norm(theme))
  const white = contrast(t, [255, 255, 255])
  const dark = contrast(t, rgbOf(DARK_TEXT))
  const best = white >= dark ? '#ffffff' : DARK_TEXT
  // どちらも4.5に届かないときは黒（白が4.5に届かない色は、黒となら必ず4.5を超える）
  return Math.max(white, dark) >= 4.5 ? best : '#000000'
}

export function themeInk(theme: string): { text: string; strong: string; on: string } {
  const t = norm(theme)
  return { text: contrast(rgbOf(t), rgbOf(BG)) >= 4.5 ? t : DARK_TEXT, strong: t, on: onTheme(t) }
}
