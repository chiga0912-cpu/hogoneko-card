// iPhoneの画面サイズで各画面を撮影する
// 使い方：npm run dev を動かした状態で
//   node scripts/screenshots.mjs <保存先フォルダ> [アドレス]
// 写真は本物の猫ではなく、色をぬっただけの仮の画像を使う
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'screenshots'
const url = process.argv[3] ?? 'http://localhost:5173'
mkdirSync(outDir, { recursive: true })

const dummy = (color, label) => ({
  name: `${label}.svg`,
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${color}"/><text x="300" y="420" font-size="60" text-anchor="middle" fill="#fff">${label}</text></svg>`,
  ),
})

const browser = await chromium.launch()
const context = await browser.newContext({ ...devices['iPhone 15'] })
const page = await context.newPage()
const shot = async (name, fullPage = false) => {
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage })
  console.log('撮影:', name)
}

await page.goto(url)
await shot('1_はじめ')

// シェルター情報
await page.getByText('シェルター情報を登録する').click()
await page.getByLabel('団体名').fill('テスト保護猫の会')
await page.getByLabel('連絡先').fill('Instagramのメッセージでどうぞ')
await page.getByLabel('毎回同じ文章').fill('予約不要です。当日は連れて帰れません。')
await page.getByLabel('いつものハッシュタグ').fill('#保護猫 #里親募集')
await shot('2_シェルター情報', true)
await page.getByRole('button', { name: '保存する' }).click()

// 猫の情報（未入力のまま進もうとしたとき）
await page.getByText('1匹の紹介をつくる').click()
await page.getByRole('button', { name: 'プレビューへ' }).click()
await shot('3a_猫の情報_未入力')

await page.locator('input[type=file]').setInputFiles([dummy('#c9a27e', '写真1'), dummy('#8fa9a3', '写真2')])
await page.getByLabel('名前').fill('テスト')
await page.getByLabel('年齢').fill('推定2歳')
await page.getByRole('button', { name: 'オス' }).click()
await page.getByLabel('性格のひとこと').fill('ひざの上が大好き')
await page.getByLabel('預かりさん・スタッフさんのひとこと').fill('毎朝、玄関までお迎えに来てくれます。')
await page.getByRole('button', { name: '済み' }).first().click()
await shot('3b_猫の情報_入力後', true)

await page.getByRole('button', { name: 'プレビューへ' }).click()
await shot('4_プレビュー')
await page.locator('.carousel').evaluate((el) => el.scrollTo({ left: el.clientWidth * 2 }))
await page.waitForTimeout(500)
await shot('4b_プレビュー_ひとこと')

await page.getByRole('button', { name: '保存へ' }).click()
await shot('5_保存')

// 戻っても入力が残っているか
await page.getByRole('button', { name: '戻る', exact: true }).click()
await page.getByRole('button', { name: '戻る', exact: true }).click()
const kept = await page.getByLabel('名前').inputValue()
console.log(kept === 'テスト' ? '確認OK: 戻っても入力が残っている' : '確認NG: 入力が消えた')

await browser.close()
