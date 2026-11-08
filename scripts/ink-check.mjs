// 画面のテーマ色の文字が地の色と、テーマ色の上の文字（白か濃い色）がテーマ色と、見やすさ4.5以上になっているかを、色を5刻みで全部確かめる（Claudeは呼ばない）
// 11/8：テーマ色はそのまま使う（作者の決定）。ボタンの色が選んだ色と同じことも確かめる
// 11/7 見直しの中2：丸める前の色で判定していたため、丸めた色が4.5をわずかに割ることがあった
// 使い方：node scripts/ink-check.mjs
import { themeInk, contrast } from '../src/lib/themeInk.ts'

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
const BG = [0xf6, 0xef, 0xe6]
let n = 0
let bad = 0
let low = 99
let example = ''
for (let r = 0; r <= 255; r += 5)
  for (let g = 0; g <= 255; g += 5)
    for (let b = 0; b <= 255; b += 5) {
      const t = hex([r, g, b])
      const ink = themeInk(t)
      const a = contrast(rgb(ink.text), BG)
      const s = ink.strong === t ? contrast(rgb(ink.on), rgb(ink.strong)) : 0 // 選んだ色と違えば NG
      n++
      const m = Math.min(a, s)
      if (m < 4.5) {
        bad++
        if (m < low) {
          low = m
          example = `${t} → 文字 ${ink.text}（${a.toFixed(3)}）・ボタン ${ink.strong} の上の文字 ${ink.on}（${s.toFixed(3)}）`
        }
      }
    }
if (bad) {
  console.log(`確認NG: テーマ色${n}色のうち${bad}色で、文字かボタンの文字が4.5未満（またはボタンが選んだ色と違う）（一番低いもの：${example}）`)
  process.exit(1)
}
console.log(`確認OK: テーマ色${n}色すべてで、文字は地の色と、ボタンの上の文字はボタン（選んだ色のまま）と、4.5以上`)
