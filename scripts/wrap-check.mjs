// カードの文字を、言葉の途中で折らないかを確かめる（#10）
// 使い方：node scripts/wrap-check.mjs
import { wordUnits, phraseUnits, wrapText } from '../src/lib/card.ts'

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
ok(keeps('11月5日（木） 13:00〜16:00', '16:00'), '時刻「16:00」を途中で分けない')
ok(u('知らせてくれる、とても几帳面').includes('とても'), '「、」のあとでは分けられる')
ok(u('ひざの上が大好き').join('') === 'ひざの上が大好き', '分けても文字は変わらない')
ok(keeps('ミルクティー・ショコラ', 'ティー・ショコラ') && !u('ミルクティー・ショコラ').some((x) => x.startsWith('・')), '「・」の前後を分けない（「ミルクティー・」で行を終えず、「・」で行を始めない）')
ok(!u('エリザベス・ミルクティー・ショコラ').some((x, i, a) => x.endsWith('・') && i < a.length - 1), '「・」で終わるまとまりを作らない')
// 文の区切りで折る（11/8 作者の決定。名前以外の文）。幅は「1文字＝1」のものさしで数える
const ctx = { measureText: (t) => ({ width: [...t].length }) }
const W = (t, w) => wrapText(ctx, t, w)
const t1 = '「（架空）毎朝玄関までお迎えに来てくれて、夜はひざの上で眠ります。とても甘えん坊です。」'
const l1 = W(t1, 14)
ok(l1.join('') === t1, `折っても文字は変わらない（${l1.join('／')}）`)
ok(!l1.some((l) => l.endsWith('とても')) && l1.some((l) => l.startsWith('とても甘えん坊')), `「眠ります。とても／甘えん坊です」ではなく「。」のあとで折る（${l1.join('／')}）`)
const t2 = '「（架空）まいにちげんかんまでおむかえにきてくれます。」'
const l2 = W(t2, 14)
ok(!l1.some((l) => /^「?（架空）$/.test(l)), `「（架空）」だけの行を作らない（閉じかっこでは、無理に折らない。${l1.join('／')}）`)
ok(!l2.some((l, i) => l.endsWith('おむか') && l2[i + 1]?.startsWith('え')), `ひらがなの言葉の途中（おむか／え）で折らない（${l2.join('／')}）`)
ok(l2.every((l) => l.length <= 14), `幅に入る（${l2.join('／')}）`)
const l3 = W('11月5日（木） 13:00〜16:00', 12)
ok(l3.some((l) => l.includes('13:00〜16:00')), `時刻のつながりを分けない（${l3.join('／')}）`)
ok(phraseUnits(t1).every((u) => !/^[、。」）]/.test(u)), '句読点や閉じかっこで始まるまとまりを作らない')
const l4 = W('あいうえおかきくけこさしすせそたちつてと', 8)
ok(l4.join('') === 'あいうえおかきくけこさしすせそたちつてと' && l4.every((l) => l.length <= 8), `とても長いまとまりは、文字で折って幅に入れる（${l4.join('／')}）`)
console.log(failures ? `確認NG が ${failures} こ` : '折り返しの確認：全部OK')
process.exit(failures ? 1 : 0)
