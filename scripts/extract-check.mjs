// 読み取りの、AIに任せない部分を確かめる（#13）。Claudeは呼ばない（費用はかからない）
// 使い方：node scripts/extract-check.mjs
// メモはすべて架空の文章
import { maskContacts, verify, inMemo, birthGuess, EMPTY } from '../src/lib/extract.ts'

let failures = 0
const ok = (c, s) => {
  console.log((c ? '確認OK: ' : '確認NG: ') + s)
  if (!c) failures++
}

// 伏せる
const m1 = maskContacts('（架空）連絡は 090-1234-5678 か test.user@example.com へ。体重は3.2kg、11/15に会います')
ok(m1.masked === 2 && m1.text.includes('［電話番号］') && m1.text.includes('［メール］') && !m1.text.includes('5678') && !m1.text.includes('example'), '電話番号とメールアドレスを伏せる')
ok(m1.text.includes('3.2kg') && m1.text.includes('11/15'), '体重や日付は伏せない')
const m2 = maskContacts('（架空）電話は０３（１２３４）５６７８です')
ok(m2.masked === 1 && !m2.text.includes('５６７８'), '全角の数字の電話番号も伏せる')
const m3 = maskContacts('ミントちゃんの近況です！')
ok(m3.masked === 0 && m3.text === 'ミントちゃんの近況です！', '伏せるものがなければ、文章はそのまま')

// 照合
const memo = '（架空）ミントちゃんの近況です！生後3か月くらいの女の子です。\nワクチンのことは代表に聞いてみます。\nひざの上でよく寝ています。毎日癒されています。'
ok(inMemo(memo, 'ひざの上で よく寝ています'), '空白の違いはそろえてから照合する')
const x = {
  ...EMPTY,
  name: { value: 'ミント', source: 'ミントちゃんの近況です' },
  sex: { value: 'メス', source: '女の子です' },
  age: { kind: 'months', amount: 3, stage: null, source: '生後3か月くらい' },
  vaccine: { value: '済み', source: 'ワクチンは済んでいます' }, // メモにない
  goodPoints: [
    { text: 'ひざの上が好き', source: 'ひざの上でよく寝ています' },
    { text: 'とても賢い', source: 'とても賢い子です' }, // メモにない
  ],
  carerWords: '毎日癒されています。',
}
const { result, dropped } = verify(memo, x)
ok(result.name?.value === 'ミント' && result.sex?.value === 'メス' && result.age?.amount === 3, '根拠がメモにある項目は残す')
ok(result.vaccine === null && dropped.includes('ワクチン'), '根拠がメモにない健康の項目は入れない')
ok(result.goodPoints.length === 1 && result.goodPoints[0].text === 'ひざの上が好き', '根拠がメモにない「いいところ」は入れない')
ok(result.carerWords === '毎日癒されています。', 'ひとことは、メモと一字一句同じなら入れる')
ok(verify(memo, { ...EMPTY, carerWords: '毎日いやされています。' }).result.carerWords === null, 'ひとことが一字でも違えば入れない')
ok(verify('（架空）毎朝お迎えに来てくれて、本当に癒されています。', { ...EMPTY, carerWords: '本当に癒されています。' }).result.carerWords === null, 'ひとことが文の途中から切り出されていたら入れない')
ok(verify('（架空）毎朝お迎えに来てくれて、本当に癒されています。', { ...EMPTY, carerWords: '（架空）毎朝お迎えに来てくれて、本当に癒されています。' }).result.carerWords !== null, 'ひとことが文の頭から終わりまでなら入れる')
ok(verify(memo, { ...EMPTY, name: { value: 'モカ', source: 'ミントちゃんの近況です' } }).result.name === null, '名前が根拠の中になければ入れない')
ok(verify(memo, { ...EMPTY, age: { kind: 'months', amount: 5, stage: null, source: '生後3か月くらい' } }).result.age === null, '年齢の数が根拠と合わなければ入れない')
ok(verify(memo, { ...EMPTY, vaccine: { value: '済み', source: 'ひざの上でよく寝ています' } }).result.vaccine === null, '根拠が健康と関係のない文なら入れない')
const g = birthGuess({ kind: 'months', amount: 3, stage: null, source: '' }, new Date(2026, 10, 5))
ok(g?.year === 2026 && g?.month === 8, '「生後3か月くらい」から、生まれた年月の推定の案（2026年8月）を作る')

console.log(failures ? `確認NG が ${failures} こ` : '読み取りの照合の確認：全部OK')
process.exit(failures ? 1 : 0)
