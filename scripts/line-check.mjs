// LINEの書き出しの形から、時刻・名前・スタンプなどを外す処理を確かめる（#12）
// 使い方：node scripts/line-check.mjs
// 例はすべて架空の文章（作者が自分で作ったトークで、名前だけ「預かりA」に置き換えたもの）
import { cleanLine } from '../src/lib/lineText.ts'

let failures = 0
const ok = (c, s) => {
  console.log((c ? '確認OK: ' : '確認NG: ') + s)
  if (!c) failures++
}

const T = '\t'
const history = [
  '[LINE] テストのトーク履歴',
  '保存日時：2026/11/05 19:04',
  '',
  '2026/11/05(木)',
  `19:00${T}預かりA${T}ミントちゃんの近況です！最近ごはんをよく食べるようになりました`,
  `19:01${T}預かりA${T}ワクチンのことは代表に聞いてみます。あ、こら、そこ乗らないの！`,
  `19:03${T}預かりA${T}"トイレも上手です`,
  'ただ夜はちょっと鳴きます',
  '',
  '爪切りはまだ苦手です"',
  `19:03${T}預かりA${T}[スタンプ]`,
  `19:04${T}預かりA${T}[写真]`,
].join('\n')

const r = cleanLine(history)
ok(r.isHistory, '履歴の形だと見分ける')
ok(!r.text.includes('預かりA'), '送った人の名前を外す')
ok(!/\d{1,2}:\d{2}/.test(r.text) && !r.text.includes('2026/11/05') && !r.text.includes('[LINE]') && !r.text.includes('保存日時'), '時刻・日付・見出し・保存日時を外す')
ok(!r.text.includes('[スタンプ]') && !r.text.includes('[写真]'), '[スタンプ]・[写真] だけの行を外す')
ok(r.text.includes('トイレも上手です\nただ夜はちょっと鳴きます\n\n爪切りはまだ苦手です') && !r.text.includes('"'), '"…" で囲まれた何行かのメッセージを、中の改行を残してまとめる')
ok(r.text.startsWith('ミントちゃんの近況です！最近ごはんをよく食べるようになりました\nワクチンのことは代表に聞いてみます。あ、こら、そこ乗らないの！'), 'メッセージの文章は一字も変えない')
console.log('  送る文章：\n' + r.text.split('\n').map((l) => '    | ' + l).join('\n') + `\n  外した行：${r.removed}`)

// ふだんの流れ（1通ずつコピーして貼る）：そのまま
const plain = 'ミントちゃんの近況です！\n最近ごはんをよく食べるようになりました'
const p = cleanLine(plain)
ok(!p.isHistory && p.text === plain, 'ふだんの文章（1通ずつコピー）は、そのまま送る')
// 続けて貼った文章（1通ずつ2通）
const two = 'ミントちゃんの近況です！\nトイレも上手です'
ok(cleanLine(two).text === two, '続けて貼った文章も、そのまま')
// 時刻が1つ入っているだけのふつうの文章は、履歴と見なさない
const memo = '19:00  ごはんの時間になると鳴きます'
ok(!cleanLine(memo).isHistory, '時刻で始まる行が1つあるだけのふつうの文章は、履歴と見なさない')
// 読めない行は捨てない
const odd = history + '\n預かりAがメッセージの送信を取り消しました\nこの行は形が違う'
const o = cleanLine(odd)
ok(o.text.includes('メッセージの送信を取り消しました') && o.text.includes('この行は形が違う'), '形の読めない行は、黙って捨てずに残す')
ok(!o.text.includes('預かりA') && o.text.includes('（送った人）がメッセージの送信を取り消しました'), '残した行の中の送った人の名前は「（送った人）」に置き換える')
// 区切りが空白2つ以上でも読む
const spaced = history.replaceAll(T, '  ')
ok(cleanLine(spaced).text === r.text, '区切りが空白2つ以上でも、同じように外す')
// 閉じる " がないときは、次の行からふつうに読む（文章を飲み込まない）
const broken = ['2026/11/05(木)', `19:00${T}預かりA${T}"閉じないメッセージ`, `19:01${T}預かりA${T}次のメッセージ`].join('\n')
const b = cleanLine(broken)
ok(b.text.includes('閉じないメッセージ') && b.text.includes('次のメッセージ') && !b.text.includes('預かりA'), '閉じる " がないときも、あとの文章を飲み込まない')

console.log(failures ? `確認NG が ${failures} こ` : 'LINEの形の確認：全部OK')
process.exit(failures ? 1 : 0)
