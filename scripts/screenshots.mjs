// iPhoneとAndroidの画面サイズで各画面を撮影し、名簿が残るかを確かめる
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
let dialogAnswer = 'yes' // 確認の窓が出たときの答え

// 保存場所（IndexedDB）の、決まった置き場所への書き込みだけを、わざと失敗させる（容量がいっぱいのときの代わり）
const breakStore = (p, store) =>
  p.evaluate((store) => {
    window.__put ??= IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...a) {
      if (this.name === store) throw new DOMException('わざと失敗させた', 'QuotaExceededError')
      return window.__put.apply(this, a)
    }
  }, store)
const fixStore = (p) =>
  p.evaluate(() => {
    if (window.__put) IDBObjectStore.prototype.put = window.__put
  })
const check = (ok, what) => {
  console.log(ok ? `確認OK: ${what}` : `確認NG: ${what}`)
  if (!ok) failures++
}

const browser = await engine.launch()
const iphone = devices['iPhone 15']
// WIDTH=android を付けると、主な流れと古い形のデータの確認を、Androidの画面の大きさ（Pixel 7・幅412px）で動かす。
// 画面の大きさを変えるだけ（iPhoneのふりのまま）。Androidの実機で確かめたことにはしない
const pixel = devices['Pixel 7']
const phone =
  process.env.WIDTH === 'android'
    ? { ...iphone, viewport: pixel.viewport, screen: pixel.screen, deviceScaleFactor: pixel.deviceScaleFactor }
    : iphone
console.log(`画面の大きさ：${phone.viewport.width}×${phone.viewport.height}（${process.env.WIDTH === 'android' ? 'Androidの幅' : 'iPhone 15'}）`)

// スクロールしなくても見えるか（画面の中にあり、下に固定されたボタンに隠れていない）
const seenWithoutScroll = async (p, loc) => {
  const el = await loc.elementHandle({ timeout: 2000 }).catch(() => null)
  if (!el) return false
  return p.evaluate((el) => {
    const r = el.getBoundingClientRect()
    if (r.height === 0 || r.top < 0 || r.bottom > window.innerHeight) return false
    const bar = document.querySelector('.bottom-bar')
    if (bar && !bar.contains(el) && r.bottom > bar.getBoundingClientRect().top) return false
    return true
  }, el)
}

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

// Androidの画面の大きさ（Pixel 7・幅412px）で、横にはみ出さないか
// 画面の大きさを確かめるだけ。Androidの実機で確かめたことにはしない
// Androidの案内（SPEC 2.0）はまだ作っていないので、今は登録から始まる
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'] })
  const p = await ctx.newPage()
  const fits = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  await p.goto(url)
  await p.getByText('シェルター登録').first().waitFor()
  await p.screenshot({ path: join(outDir, '0d_Android_登録.png'), fullPage: true })
  check(await fits(), 'Androidの画面の大きさ（412px）で、登録画面が横にはみ出さない')
  await p.getByLabel('団体名').fill('テスト保護猫の会')
  await p.getByRole('button', { name: '登録して始める' }).click()
  await p.getByText('新しい子を紹介').waitFor()
  await p.screenshot({ path: join(outDir, '0f_Android_ホーム.png') })
  check(await fits(), 'Androidの画面の大きさで、ホームが横にはみ出さない')
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  await p.getByLabel('名前').waitFor()
  await p.screenshot({ path: join(outDir, '0g_Android_入力.png'), fullPage: true })
  check(await fits(), 'Androidの画面の大きさで、入力画面が横にはみ出さない')
  await ctx.close()
}

// 古い形・壊れた形の仮のデータを入れて開いても、真っ白にならず、名簿が消えないか（見直し A1）
// 写真は使わない。11/4に公開した最初の形（版の番号なし・項目が足りない）をまねる
{
  const ctx = await browser.newContext({ ...phone })
  const errors = []
  let p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(url)
  await p.getByText('はじめに').waitFor() // ここで保存場所ができている
  const put = (stores) =>
    p.evaluate(
      (stores) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('hogoneko-card')
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction(Object.keys(stores), 'readwrite')
            for (const [name, items] of Object.entries(stores))
              for (const [key, value] of items) key === null ? tx.objectStore(name).put(value) : tx.objectStore(name).put(value, key)
            tx.oncomplete = () => resolve(true)
            tx.onerror = () => reject(tx.error)
          }
          req.onerror = () => reject(req.error)
        }),
      stores,
    )
  const countCats = () =>
    p.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('hogoneko-card')
          req.onsuccess = () => {
            const r = req.result.transaction('cats').objectStore('cats').getAll()
            r.onsuccess = () => resolve(r.result.length)
          }
        }),
    )
  await put({
    shelter: [['main', { name: '古い形の会' }]], // ハッシュタグなどの項目がない
    cats: [
      [null, { id: 'old-1', name: '古い形の子', updatedAt: 2 }], // 写真も健康の項目もない
      [null, { id: 'old-2', name: '健康がこわれた子', photos: 'x', vaccine: 'x', age: 3, updatedAt: 1 }],
      [null, { id: 12345, name: '読めない子' }], // id の形が違う（読めない子）
    ],
    drafts: [['main', { cat: { id: 'd-1', name: '途中の子' }, screen: 'cat' }]], // 健康の項目がない途中
  })
  await p.reload()
  await p.getByLabel('名前').waitFor({ timeout: 5000 }).catch(() => {})
  check((await p.getByLabel('名前').inputValue().catch(() => '')) === '途中の子', '古い形の「入力の途中」でも、真っ白にならずに入力画面が開く')
  await p.screenshot({ path: join(outDir, '0h_古い形_途中.png') })
  await p.getByRole('button', { name: '戻る' }).click()
  await p.getByText('新しい子を紹介').waitFor()
  check(await p.getByText('読めなかった子が1匹います').isVisible(), '読めなかった子がいると、ホームで「読めなかった子が1匹います」と知らせる')
  check(await seenWithoutScroll(p, p.getByText('読めなかった子が1匹います')), '「読めなかった子」の知らせは、スクロールしなくても見える')
  check(await p.getByText('2匹').isVisible(), '読めた子（2匹）は名簿に出る')
  await p.screenshot({ path: join(outDir, '0i_古い形_ホーム.png') })
  await p.getByRole('button', { name: /名簿から選ぶ/ }).click()
  await p.getByRole('button', { name: /健康がこわれた子/ }).first().click()
  await p.getByLabel('名前').waitFor()
  check((await p.getByLabel('名前').inputValue()) === '健康がこわれた子', '健康の項目がこわれた子を名簿から選んでも、真っ白にならずに開く')
  // 写真を4枚選ぶと、3枚までと知らせる（見直し A11）
  await p.locator('input[type=file]').setInputFiles(['写真1', '写真2', '写真3', '写真4'].map((l) => dummy('#c9a27e', l)))
  await p.getByText('最初の3枚を入れました').waitFor({ timeout: 3000 }).catch(() => {})
  check(await p.getByText('写真は3枚までです。選んだうちの最初の3枚を入れました').isVisible(), '写真を4枚選ぶと、3枚までと知らせる')
  check(await seenWithoutScroll(p, p.getByText('写真は3枚までです')), '「写真は3枚まで」の知らせは、スクロールしなくても見える')
  // 入力の途中を残せないとき（見直し A2）。下までスクロールしていても見えるか
  await breakStore(p, 'drafts')
  await p.getByLabel('預かりさん・スタッフさんのひとこと（なくてもOK）').fill('（架空）残せないときの試し')
  await p.getByText('入力の途中を、スマホの中に残せませんでした').waitFor({ timeout: 3000 }).catch(() => {})
  check(await seenWithoutScroll(p, p.getByText('入力の途中を、スマホの中に残せませんでした')), '入力の途中を残せないときの知らせが、スクロールしなくても見える（下の方を入力中でも）')
  await p.screenshot({ path: join(outDir, '0k_途中を残せない.png') })
  // 入力の途中を、こわれた形にして開き直す
  // （開いたまま書き換えると、閉じるときの自動保存で上書きされるので、一度閉じてから、アプリではないページで書き換える）
  await p.waitForTimeout(600)
  await p.close()
  p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(url + '/favicon.svg')
  await put({ drafts: [['main', 'こわれた途中']] })
  await p.goto(url)
  await p.getByText('新しい子を紹介').waitFor({ timeout: 5000 }).catch(() => {})
  check(await p.getByText('入力の途中の内容が読めなかったので、ホームから始めます').isVisible(), '入力の途中が読めないときは、ホームへ出して知らせる')
  check(await seenWithoutScroll(p, p.getByText('入力の途中の内容が読めなかったので')), '「入力の途中が読めなかった」の知らせは、スクロールしなくても見える')
  await p.screenshot({ path: join(outDir, '0j_古い形_途中が読めない.png') })
  check((await countCats()) === 3, `読めなかった子も消さずに残っている（保存場所に${await countCats()}匹）`)
  check(!(await p.getByText('プライベートブラウズでは使えません').isVisible()), '理由と違う「プライベートブラウズでは使えません」が出ない')
  check(errors.length === 0, `画面の途中で止まるエラーが出ない${errors.length ? '：' + errors[0] : ''}`)
  await ctx.close()
}

const context = await browser.newContext({ ...phone })
// 健康情報を「前に確認した」状態にするため、最初は11/1として動かす（時計だけ変える）
let page = await context.newPage()
await page.clock.setFixedTime(new Date('2026-11-01T10:00:00'))
page.on('dialog', (d) => (dialogAnswer === 'yes' ? d.accept() : d.dismiss()))
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
check(await page.getByText('ホーム画面に追加しないと、しばらく開かないときに名簿が消えることがあります').isVisible(), '案内を飛ばした人には、ホームで名簿が消えることがあると知らせる')
// 開いてすぐ戻っただけなら、「入力の続き」にしない（見直し A9）
await page.getByRole('button', { name: '新しい子を紹介' }).click()
await page.getByLabel('名前').waitFor()
await page.waitForTimeout(500)
await page.getByRole('button', { name: '戻る' }).click()
await page.getByText('新しい子を紹介').waitFor()
check(!(await page.getByText('入力の続き').isVisible()), '開いてすぐ戻っただけなら、「入力の続き」は出ない')

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
// 手で直した投稿文は、［戻る］→［次へ］で黙って消えない（見直し A3）
await postBox.fill(post + '\n手で直した一文')
dialogAnswer = 'no'
await page.getByRole('button', { name: '戻る' }).click()
await page.getByRole('button', { name: '次へ' }).click()
check((await postBox.inputValue()).includes('手で直した一文'), '手で直した投稿文は、［戻る］→［次へ］でも残る（作り直すかを聞いて「いいえ」）')
dialogAnswer = 'yes'
await page.getByRole('button', { name: '戻る' }).click()
await page.getByRole('button', { name: '次へ' }).click()
check((await postBox.inputValue()) === post, '作り直すかを聞いて「はい」なら、入力の内容で作り直す')
// 名簿への保存を、わざと失敗させる（見直し A2）
await breakStore(page, 'cats')
await page.getByRole('button', { name: '名簿に保存する' }).click()
await page.getByText('名簿に保存できませんでした').waitFor({ timeout: 3000 }).catch(() => {})
check(await page.getByText('名簿に保存できませんでした。もう一度押してください。').isVisible(), '名簿への保存に失敗すると、知らせが出る')
check(await seenWithoutScroll(page, page.getByText('名簿に保存できませんでした')), '名簿への保存の失敗の知らせは、スクロールしなくても見える')
check(await page.getByRole('button', { name: '名簿に保存する' }).isEnabled(), '名簿への保存に失敗しても、ボタンが押せる状態に戻る')
check((await postBox.inputValue()) === post, '名簿への保存に失敗しても、投稿文は消えない')
await shot('5c_確認_保存の失敗')
await page.getByRole('button', { name: '戻る' }).click()
check((await page.getByLabel('名前').inputValue()) === 'テスト' && (await page.locator('.photo img').count()) === 2, '名簿への保存に失敗しても、入力した名前と写真は消えない')
await page.getByRole('button', { name: '次へ' }).click()
await fixStore(page)
await page.getByRole('button', { name: '名簿に保存する' }).click()
await page.getByText('名簿に保存しました').waitFor()
await shot('6_保存_仮')
// コピーを、わざと失敗させる（見直し A10）
await page.evaluate(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('わざと失敗させた')) }, configurable: true })
  document.execCommand = () => false
})
await page.getByRole('button', { name: '投稿文をコピー' }).click()
await page.waitForTimeout(200)
check(!(await page.getByText('コピーしました ✓').isVisible()), 'コピーに失敗すると、「コピーしました ✓」が出ない')
check(await page.getByText('コピーできませんでした。下の投稿文を長押しして、コピーしてください。').isVisible(), 'コピーに失敗すると、知らせが出る')
check(await seenWithoutScroll(page, page.getByText('コピーできませんでした')), 'コピーの失敗の知らせは、スクロールしなくても見える')
check(
  (await page.locator('.copy-fallback').isVisible()) && (await page.locator('.copy-fallback').inputValue()) === post,
  'コピーに失敗すると、長押しでコピーできる欄に投稿文が出る',
)
await shot('6b_保存_コピーの失敗', true)

// 7. タブを閉じて開き直しても、登録と名簿が残るか
await page.close()
page = await context.newPage()
page.on('dialog', (d) => (dialogAnswer === 'yes' ? d.accept() : d.dismiss()))
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
// 「#保護猫#里親募集」のように続けて書いても、2こに分ける（見直し A4。保存はしない）
await page.getByLabel('いつものハッシュタグ').fill('#保護猫#里親募集')
check(await page.getByText('2こ', { exact: true }).isVisible(), '「#保護猫#里親募集」と続けて書いても、2こと数える')
// シェルター情報の保存を、わざと失敗させる（見直し A2）
await breakStore(page, 'shelter')
await page.getByRole('button', { name: '保存する' }).click()
await page.getByText('保存できませんでした。もう一度押してください。').waitFor({ timeout: 3000 }).catch(() => {})
check(await page.getByText('保存できませんでした。もう一度押してください。').isVisible(), 'シェルター情報の保存に失敗すると、知らせが出る')
check(await seenWithoutScroll(page, page.getByText('保存できませんでした。もう一度押してください。')), 'シェルター情報の保存の失敗の知らせは、スクロールしなくても見える')
check(await page.getByRole('button', { name: '保存する' }).isEnabled(), 'シェルター情報の保存に失敗しても、ボタンが押せる状態に戻る')
check((await page.getByLabel('いつものハッシュタグ').inputValue()) === '#保護猫#里親募集' && (await page.getByLabel('団体名').inputValue()) === 'テスト保護猫の会', 'シェルター情報の保存に失敗しても、入力した内容は消えない')
await shot('10b_シェルター情報_保存の失敗')
await fixStore(page)
console.log('表示:', await page.locator('.status-line').innerText())

await browser.close()
console.log(failures ? `確認NGが${failures}こあります` : 'すべて確認OK')
process.exit(failures ? 1 : 0)
