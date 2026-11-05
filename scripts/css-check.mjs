// 見た目の指定（src/index.css）の「{」と「}」の数がそろっているかを確かめる
// （11/6 2つの作業場所を取り込んだときに「}」を1つ落とし、そのあとの指定が効かなかったため）
import { readFileSync } from 'node:fs'
const s = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
let depth = 0
let line = 1
for (const ch of s) {
  if (ch === '\n') line++
  if (ch === '{') depth++
  if (ch === '}') depth--
  if (depth < 0 || depth > 2) {
    console.log(`確認NG: 見た目の指定のかっこがそろっていない（${line}行目のあたり）`)
    process.exit(1)
  }
}
if (depth !== 0) {
  console.log('確認NG: 見た目の指定に、閉じていない「{」がある')
  process.exit(1)
}
console.log('見た目の指定のかっこの確認：OK')
