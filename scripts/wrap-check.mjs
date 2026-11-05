// カードの文字を、言葉の途中で折らないかを確かめる（#10）
// 使い方：node scripts/wrap-check.mjs
import { wordUnits } from '../src/lib/card.ts'

let failures = 0
const ok = (c, s) => {
  console.log((c ? '確認OK: ' : '確認NG: ') + s)
  if (!c) failures++
}
const u = (t) => wordUnits(t)
const keeps = (t, word) => u(t).some((x) => x.includes(word))
ok(keeps('ごはんの時間を教えてくれる', '教えてくれる'), '「教えてくれる」を途中で分けない（前は「教えてく／れる」と折れた）')
ok(keeps('（平日10時〜17時）', '10時〜17時'), '時刻のつながり「10時〜17時」を分けない')
ok(keeps('Instagramのメッセージでお問い合わせください', 'お問い合わせください'), '「お問い合わせ」の「お」を前の言葉にくっつけない')
ok(u('知らせてくれる、とても几帳面').includes('とても'), '「、」のあとでは分けられる')
ok(u('ひざの上が大好き').join('') === 'ひざの上が大好き', '分けても文字は変わらない')
console.log(failures ? `確認NG が ${failures} こ` : '折り返しの確認：全部OK')
process.exit(failures ? 1 : 0)
