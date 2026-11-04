// iPhoneの画面サイズで各画面を撮影し、名簿が残るかを確かめる
// 使い方：npm run dev を動かした状態で
//   node scripts/screenshots.mjs <保存先フォルダ> [アドレス]
//   ENGINE=webkit を付けると、Safariと同じ仕組み（WebKit）で動かす
// 写真は本物の猫ではなく、色をぬっただけの仮の画像を使う
import { chromium, webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'screenshots'
const url = process.argv[3] ?? 'http://localhost:5173'
const engine = process.env.ENGINE === 'webkit' ? webkit : chromium
mkdirSync(outDir, { recursive: true })

const dummy = (color, label) => ({
  name: `${label}.svg`,
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${color}"/><text x="300" y="420" font-size="60" text-anchor="middle" fill="#fff">${label}</text></svg>`,
  ),
})

let failures = 0
const check = (ok, what) => {
  console.log(ok ? `確認OK: ${what}` : `確認NG: ${what}`)
  if (!ok) failures++
}

const browser = await engine.launch()
const iphone = devices['iPhone 15']

// iPhoneのChromeで初めて開いたとき（Chromeは「CriOS」と名乗る）
{
  const ctx = await browser.newContext({
    ...iphone,
    userAgent: iphone.userAgent.replace(/Version\/[\d.]+/, 'CriOS/140.0.0.0'),
  })
  const p = await ctx.newPage()
  await p.goto(url)
  await p.getByText('はじめに').waitFor()
  await p.screenshot({ path: join(outDir, '0b_案内_Chrome.png'), fullPage: true })
  check(await p.getByText('下までスクロール').isVisible(), 'Chromeでは、Chrome用の手順（一覧を下までスクロール）が出る')
  await ctx.close()
}

// ホーム画面のアイコンから開いたとき（案内は出さない。アイコンを消すと名簿も消えることを知らせる）
{
  const ctx = await browser.newContext({ ...iphone })
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }))
  const p = await ctx.newPage()
  await p.goto(url)
  await p.getByText('シェルター登録').first().waitFor()
  check(!(await p.getByText('はじめに').isVisible()), 'ホーム画面のアプリでは、案内を出さずに登録から始まる')
  check(await p.getByText('このアイコンを消すと、名簿も消えます').isVisible(), 'ホーム画面のアプリの登録画面に、アイコンを消すと名簿も消えると出る')
  check((await p.locator('.status-line').innerText()).includes('ホーム画面のアプリ'), '確認用の文字に「ホーム画面のアプリ」と出る')
  await p.screenshot({ path: join(outDir, '0c_ホーム画面のアプリ_登録.png'), fullPage: true })
  await ctx.close()
}

const context = await browser.newContext({ ...iphone })
// 健康情報を「前に確認した」状態にするため、最初は11/1として動かす（時計だけ変える）
let page = await context.newPage()
await page.clock.setFixedTime(new Date('2026-11-01T10:00:00'))
page.on('dialog', (d) => d.accept())
const shot = async (name, fullPage = false) => {
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage })
  console.log('撮影:', name)
}

// 1. 初めて開いたとき：ホーム画面に追加する案内（Safari）
await page.goto(url)
await page.getByText('はじめに').waitFor()
await shot('0a_案内_Safari', true)
check(await page.getByText('ブラウザごと').isVisible(), '案内に「ブラウザごとに分かれて残る」が出る')
check(await page.getByText('このアイコンを消すと、名簿も消えます').isVisible(), '案内に「アイコンを消すと名簿も消える」が出る')
check(await page.getByText('横線3本のボタン').isVisible() && await page.getByText('「表示を増やす」').isVisible(), 'Safariの手順が、本物の画面の流れ（横線3本 → 共有 → 表示を増やす）になっている')
check(await page.getByText('プライベートブラウズでは「ホーム画面に追加」が出ないことがあります').isVisible(), 'Safariでは、プライベートブラウズの注意が出る')
{
  // スクロールしなくても、アイコンの注意が下のボタンに隠れずに見えるか
  const box = await page.getByText('このアイコンを消すと、名簿も消えます').boundingBox()
  const barTop = (await page.locator('.bottom-bar button').boundingBox()).y
  check(box && box.y + box.height <= barTop, `スクロールしなくても、アイコンの注意が見える（注意の下端 ${Math.round(box.y + box.height)} ／ ボタンの上端 ${Math.round(barTop)}）`)
  await page.screenshot({ path: join(outDir, '0e_案内_Safari_画面のまま.png') })
}
await page.getByRole('button', { name: '追加せずに、このまま使う' }).click()

// 2. シェルター登録（団体名だけ必須）
await page.getByRole('button', { name: '登録して始める' }).click()
await shot('1a_登録_団体名なし')
check(await page.getByText('団体名を入れてください').isVisible(), '団体名が空だと先へ進めない')
await page.getByLabel('団体名').fill('テスト保護猫の会')
await page.locator('input[type=file]').setInputFiles(dummy('#e8826b', 'ロゴ'))
await page.getByLabel('連絡先').fill('InstagramのDMでどうぞ')
await page.getByLabel('毎回同じ文章').fill('譲渡会は予約不要です。')
await page.getByLabel('いつものハッシュタグ').fill('#保護猫 #里親募集 #猫 #ねこ #保護猫カフェ #譲渡会 #cat')
await page.getByLabel('いつもの譲渡会場所').fill('テスト公民館')
await shot('1b_登録_入力後', true)
await page.getByRole('button', { name: '登録して始める' }).click()
await page.getByText('新しい子を紹介').waitFor()
await shot('2_ホーム')

// 3. 入力（未入力で次へ）
await page.getByRole('button', { name: '新しい子を紹介' }).click()
await page.getByRole('button', { name: '次へ' }).click()
await shot('3a_入力_未入力')
check(await page.getByText('まだ入っていません：写真、名前').isVisible(), '写真と名前がないと先へ進めない')
await shot('3b_入力_最初の状態', true)

// 4. 入力する（手入力だけ）
await page.locator('input[type=file]').setInputFiles([dummy('#c9a27e', '写真1'), dummy('#8fa9a3', '写真2')])
await page.locator('.photo img').nth(1).waitFor()
await page.getByLabel('預かりさんからのメッセージ・メモ').fill('（架空のメモ）ひざの上が好きな子です。')
await page.getByLabel('名前').fill('テスト')
await page.getByRole('button', { name: '生まれた年月' }).click()
await page.getByLabel('生まれた年月').fill('2026-08')
await page.getByLabel('推定').check()
await page.getByRole('group', { name: '性別' }).getByRole('button', { name: 'オス' }).click()
await page.getByRole('group', { name: 'ワクチン' }).getByRole('button', { name: '済み', exact: true }).click()
await page.locator('.health').first().getByLabel('投稿文に載せる').check()
await page.getByRole('group', { name: '猫エイズ・白血病の検査' }).getByRole('button', { name: '陰性' }).click()
await page.getByLabel('いいところ').fill('ひざの上が大好き\nごはんの時間を教えてくれる')
await page.getByLabel('預かりさん・スタッフさんのひとこと（なくてもOK）').fill('毎朝、玄関までお迎えに来てくれます。')
await shot('4_入力_入力後', true)
check(await page.getByText('今は「推定生後3か月」').isVisible(), '生まれた年月から月齢が出る（11/1時点で生後3か月）')

// 5. 入力の途中で読み込み直しても残るか（LINEに移って戻ったときの代わり）
await page.waitForTimeout(600)
await page.reload()
await page.getByLabel('名前').waitFor()
check((await page.getByLabel('名前').inputValue()) === 'テスト', '読み込み直しても、名前が残る')
check((await page.locator('.photo img').count()) === 2, '読み込み直しても、写真2枚が残る')
check((await page.getByLabel('いいところ').inputValue()).includes('ごはんの時間'), '読み込み直しても、いいところが残る')

// 6. 確認（仮）→ 名簿に保存
await page.getByRole('button', { name: '次へ' }).click()
await shot('5_確認_仮')
const post = await page.getByLabel('投稿文（その場で直せます）').inputValue()
check((post.match(/#/g) ?? []).length === 5, `ハッシュタグを7こ登録しても、投稿文は5つまで（${(post.match(/#/g) ?? []).length}こ）`)
check(post.includes('ワクチン：済み') && !post.includes('陰性'), '健康は「載せる」を選んだものだけ投稿文に出る')
check(post.includes('推定生後3か月・オス'), '年齢と性別が投稿文に出る')
// 投稿文を直して「#」を足し、6こになったら先へ進めない
const postBox = page.getByLabel('投稿文（その場で直せます）')
await postBox.fill(post + ' ＃追加のタグ')
check(await page.getByRole('button', { name: '名簿に保存する' }).isDisabled(), '投稿文のハッシュタグが6こになると、先へ進めない')
await shot('5b_確認_ハッシュタグ6こ')
await postBox.fill(post)
await page.getByRole('button', { name: '名簿に保存する' }).click()
await page.getByText('名簿に保存しました').waitFor()
await shot('6_保存_仮')

// 7. タブを閉じて開き直しても、登録と名簿が残るか
await page.close()
page = await context.newPage()
page.on('dialog', (d) => d.accept())
// 1か月後（12/2）に開いた、という形にする
await page.clock.setFixedTime(new Date('2026-12-02T10:00:00'))
await page.goto(url)
await page.getByText('新しい子を紹介').waitFor()
check(await page.getByText('テスト保護猫の会').isVisible(), 'タブを閉じて開き直しても、シェルター登録が残る')
check(await page.getByText('1匹').isVisible(), 'タブを閉じて開き直しても、名簿に1匹残る')
check(await page.locator('.hero-logo').isVisible(), 'ロゴが残る')
await shot('7_ホーム_開き直し')

// 8. 名簿から選ぶ → 前の内容入り＋健康情報の知らせ
await page.getByRole('button', { name: /名簿から選ぶ/ }).click()
await shot('8_名簿')
await page.getByRole('button', { name: /テスト/ }).first().click()
await page.getByLabel('名前').waitFor()
check((await page.getByLabel('名前').inputValue()) === 'テスト', '名簿から選ぶと、前の内容が入っている')
check(await page.getByText('今は「推定生後4か月」').isVisible(), '月齢が自動で増える（12/2には生後4か月）')
check(await page.getByText('健康情報は前回（11月1日）のものです。').isVisible(), '健康情報の知らせが出る')
await shot('9a_名簿の子_健康の知らせ', true)
await page.getByRole('button', { name: '今も正しい' }).click()
check(!(await page.getByText('健康情報は前回').isVisible()), '［今も正しい］で知らせが消える')
await shot('9b_名簿の子_確認後')

// 9. もう一度保存しても、名簿は2匹に増えない
await page.getByRole('button', { name: '次へ' }).click()
await page.getByRole('button', { name: '名簿に保存する' }).click()
await page.getByText('名簿に保存しました').waitFor()
await page.getByRole('button', { name: 'ホームへ' }).click()
check(await page.getByText('1匹').isVisible(), '同じ子を保存し直しても、名簿は1匹のまま')

// 10. 保存の状態の表示
await page.getByRole('button', { name: 'シェルター情報を直す' }).click()
await shot('10_シェルター情報', true)
console.log('表示:', await page.locator('.status-line').innerText())

await browser.close()
console.log(failures ? `確認NGが${failures}こあります` : 'すべて確認OK')
process.exit(failures ? 1 : 0)
