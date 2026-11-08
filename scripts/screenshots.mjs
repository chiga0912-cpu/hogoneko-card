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

const dummy = (color, label, w = 600, h = 800) => ({
  name: `${label}.svg`,
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${color}"/><text x="${w / 2}" y="${h / 2 + 20}" font-size="60" text-anchor="middle" fill="#fff">${label}</text></svg>`,
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

// ツールの画面の中の確認の知らせ（#43）に、自動で答える。window.__confirmAnswer が 'no' なら［やめる］側、ほかは［はい］側を押す。
// ブラウザの確認の窓が出たら数える（もう出ないはず）
const AUTO_CONFIRM = () => {
  window.__browserDialogs = 0
  const tick = () => {
    const d = document.querySelector('[data-confirm-dialog]')
    if (d && !d.dataset.answered && !window.__confirmManual) {
      d.dataset.answered = '1'
      const btn = d.querySelector(window.__confirmAnswer === 'no' ? '[data-confirm="no"]' : '[data-confirm="yes"]')
      window.__confirmSeen = (window.__confirmSeen ?? 0) + 1
      setTimeout(() => btn?.click(), 50)
    }
  }
  new MutationObserver(tick).observe(document, { childList: true, subtree: true })
}
{
  const _newContext = browser.newContext.bind(browser)
  browser.newContext = async (o) => {
    const c = await _newContext(o)
    await c.addInitScript(AUTO_CONFIRM)
    c.on('page', (pg) => pg.on('dialog', () => pg.evaluate(() => (window.__browserDialogs += 1)).catch(() => {})))
    return c
  }
}
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
  await p.getByRole('textbox', { name: /^名前/ }).waitFor()
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
              for (const [key, value] of items) {
                if (key === null) tx.objectStore(name).put(value)
                else tx.objectStore(name).put(value, key)
              }
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
  await p.getByRole('textbox', { name: /^名前/ }).waitFor({ timeout: 5000 }).catch(() => {})
  check((await p.getByRole('textbox', { name: /^名前/ }).inputValue().catch(() => '')) === '途中の子', '古い形の「入力の途中」でも、真っ白にならずに入力画面が開く')
  await p.screenshot({ path: join(outDir, '0h_古い形_途中.png') })
  await p.getByRole('button', { name: '戻る' }).click()
  await p.getByText('新しい子を紹介').waitFor()
  check(await p.getByText('読めなかった子が1匹います').isVisible(), '読めなかった子がいると、ホームで「読めなかった子が1匹います」と知らせる')
  check(await seenWithoutScroll(p, p.getByText('読めなかった子が1匹います')), '「読めなかった子」の知らせは、スクロールしなくても見える')
  check(await p.getByText('2匹').isVisible(), '読めた子（2匹）は名簿に出る')
  await p.screenshot({ path: join(outDir, '0i_古い形_ホーム.png') })
  await p.getByRole('button', { name: /名簿から選ぶ/ }).click()
  await p.getByRole('button', { name: /健康がこわれた子/ }).first().click()
  await p.getByRole('textbox', { name: /^名前/ }).waitFor()
  check((await p.getByRole('textbox', { name: /^名前/ }).inputValue()) === '健康がこわれた子', '健康の項目がこわれた子を名簿から選んでも、真っ白にならずに開く')
  // 写真を4枚選ぶと、3枚までと知らせる（見直し A11）
  await p.locator('input[type=file][accept="image/*"]').setInputFiles(['写真1', '写真2', '写真3', '写真4'].map((l) => dummy('#c9a27e', l)))
  await p.getByText('最初の3枚を入れました').waitFor({ timeout: 3000 }).catch(() => {})
  check(await p.getByText('写真は3枚までです。選んだうちの最初の3枚を入れました').isVisible(), '写真を4枚選ぶと、3枚までと知らせる')
  check(await seenWithoutScroll(p, p.getByText('写真は3枚までです')), '「写真は3枚まで」の知らせは、スクロールしなくても見える')
  // 入力の途中を残せないとき（見直し A2）。下までスクロールしていても見えるか
  await breakStore(p, 'drafts')
  await p.getByLabel('見る人へのひとこと（なくてもOK）').fill('（架空）残せないときの試し')
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

// 猫カード：長い名前・長い「いいところ」・「いいところ」が空・明るいテーマ色（仮の画像）
{
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(url)
  await p.getByText('はじめに').waitFor()
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p.getByLabel('団体名').fill('テスト保護猫の会')
  await p.locator('input[type=color]').fill('#fff27a') // 明るいテーマ色
  await p.getByRole('button', { name: '登録して始める' }).click()
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  await p.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#8fa9a3', '写真'))
  await p.locator('.photo img').first().waitFor()
  await p.getByRole('textbox', { name: /^名前/ }).fill('とてもながいなまえのテストねこエリザベス・ミルクティー・ショコラ・ド・マカロン三世')
  await p
    .getByLabel('いいところ')
    .fill(
      [
        '（架空）朝はいちばんに起きてきて、台所の前でごはんの時間を知らせてくれる、とても几帳面な子です',
        '（架空）ほかの猫とも仲よくでき、子猫が来たときは毛づくろいをしてあげる、面倒見のよいお兄さんです',
        '（架空）抱っこはまだ少し苦手ですが、ひざの上には自分から乗ってきて、そのまま一時間でも眠っています',
      ].join('\n'),
    )
  await p.getByRole('button', { name: '次へ' }).click()
  const card = p.locator('.card-canvas')
  await p.locator('.card-canvas[data-drawn="1"]').waitFor()
  await p.waitForTimeout(300)
  const a = async (k) => card.getAttribute(k)
  check((await a('data-fits')) === '1', '長い名前と長い「いいところ」でも、文字がカードからはみ出さない')
  console.log(
    `  どう収めたか：文字の大きさ ${Math.round(Number(await a('data-scale')) * 100)}%、いいところ ${await a('data-lines-shown')}/${await a('data-lines-total')}行（行の途中では切らない）`,
  )
  check(Number(await a('data-contrast')) >= 4.5, `明るいテーマ色でも、カードの文字が読みやすい（見やすさ ${await a('data-contrast')}）`)
  await p.screenshot({ path: join(outDir, '5f_猫カード_長い名前と長いいいところ_明るい色.png'), fullPage: true })
  check((await a('data-design')) === 'A', '縦の写真は、案A（写真の上に白い文字）になる')
  check(!(await p.getByRole('group', { name: 'カードの案（見比べ用）' }).isVisible()) && !(await p.getByRole('group', { name: '文字の大きさ（試し用）' }).isVisible()), '見比べ用・試し用のボタンは出ない')
  // 横の写真・正方形の写真は案B（明るいテーマ色の帯でも読めるか、長い文字がはみ出さないか）
  for (const [label, w, h] of [['横', 800, 600], ['正方形', 700, 700]]) {
    await p.getByRole('button', { name: '戻る' }).click()
    await p.getByRole('button', { name: '写真1を外す' }).click()
    await p.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#8fa9a3', label, w, h))
    await p.locator('.photo img').first().waitFor()
    await p.getByRole('button', { name: '次へ' }).click()
    await p.locator('.card-canvas[data-design="B"][data-drawn="1"]').waitFor({ timeout: 3000 }).catch(() => {})
    await p.waitForTimeout(300)
    check((await a('data-design')) === 'B', `${label}の写真は、案B（上下に色の帯）になる`)
    check((await a('data-fits')) === '1', `${label}の写真（案B）でも、長い文字がはみ出さない（${Math.round(Number(await a('data-scale')) * 100)}%・${await a('data-lines-shown')}/${await a('data-lines-total')}行）`)
    if (label === '横') {
      // 猫カードの言葉（SPEC 2.4・3.1。11/6夜）：2つまで・1つ2行まで。長い行は飛ばして次の行。ひとことと同じ行は使わない。年齢と性別の1行
      const r = await p.evaluate(async () => {
        try {
          const m = await import('/src/lib/card.ts')
          const age = await import('/src/lib/age.ts')
          const c = document.createElement('canvas')
          c.width = 1080
          c.height = 1920
          const tall = document.createElement('canvas')
          tall.width = 600
          tall.height = 800
          const wide = document.createElement('canvas')
          wide.width = 800
          wide.height = 600
          const long = '（架空）朝はいちばんに起きてきて、台所の前でごはんの時間を知らせてくれる、とても几帳面な子です'
          const draw = (photo, lines, extra = {}) => {
            const l = m.drawCatCard(c.getContext('2d'), { photo, logo: null, name: 'テスト', lines, theme: '#e8826b', position: 'normal', ...extra })
            return { word: l.word, words: l.words, index: l.wordIndex, rows: l.wordRows, long: l.skippedLong, same: l.skippedSame, fits: l.fits, contrast: l.contrast }
          }
          const out = {}
          for (const [k, photo] of [['A', tall], ['B', wide]]) {
            out[k] = {
              short: draw(photo, ['（架空）よく食べる', '（架空）人懐っこい']),
              three: draw(photo, ['（架空）よく食べる', '（架空）人懐っこい', '（架空）よく遊ぶ']),
              two: draw(photo, ['（架空）毎朝玄関までお迎えに来てくれる子']),
              skip: draw(photo, [long, '（架空）なでると喉を鳴らす']),
              none: draw(photo, [long]),
              same: draw(photo, ['（架空）よく食べる', '（架空）人懐っこい'], { avoid: '（架空）よく食べる。' }),
              empty: draw(photo, [], { profile: '推定2歳・男の子' }),
            }
          }
          // 案Bでは、下の帯（下300）に文字も写真も置かない：その所が帯の色1色だけか
          m.drawCatCard(c.getContext('2d'), { photo: wide, logo: null, name: 'テスト', profile: '推定2歳・男の子', lines: ['（架空）毎朝玄関までお迎えに来てくれる子'], theme: '#e8826b', position: 'normal' })
          const d = c.getContext('2d').getImageData(0, 1920 - 300, 1080, 300).data
          let other = 0
          for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) other++
          out.bottomClean = other === 0
          const birth = (months) => {
            const d = new Date()
            d.setMonth(d.getMonth() - months)
            return { mode: 'birth', birthYear: d.getFullYear(), birthMonth: d.getMonth() + 1, estimated: true }
          }
          // 動画の中の猫カードの長さ：言葉が1つなら4秒、2つなら5秒、なければ3秒（SPEC 3.2。11/6夜）
          const reel = await import('/src/lib/reel.ts')
          const types = await import('/src/types.ts')
          const secOf = async (goodPoints) => {
            const segs = await reel.buildSegments({ ...types.newCat(), name: 'テスト', goodPoints }, types.emptyShelter(), null, null)
            return segs.find((x) => x.label === '猫カード')?.sec
          }
          out.sec = [await secOf(['（架空）よく食べる']), await secOf(['（架空）毎朝玄関までお迎えに来てくれる子']), await secOf([]), await secOf(['（架空）よく食べる', '（架空）人懐っこい'])]
          out.profile = [
            age.cardProfile(birth(26), 'オス'),
            age.cardProfile(birth(3), 'メス'),
            age.cardProfile({ mode: 'unknown' }, 'オス'),
            age.cardProfile(birth(26), '未確認'),
            age.cardProfile({ mode: 'unknown' }, '未確認'),
          ]
          return out
        } catch {
          return null // 本番と同じ作りでは、部品を直接読めない
        }
      })
      if (r) {
        for (const k of ['A', 'B']) {
          const t = r[k]
          check(JSON.stringify(t.short.words) === JSON.stringify(['（架空）よく食べる', '（架空）人懐っこい']) && t.short.fits, `案${k}：カードの言葉は「いいところ」の上から2つ（${JSON.stringify(t.short.words)}）`)
          check(t.three.words.length === 2 && t.three.fits, `案${k}：「いいところ」が3行あっても、カードの言葉は2つまで`)
          check(t.short.contrast >= 4.5, `案${k}：白い文字の見やすさは4.5以上（${t.short.contrast}）`)
          check(t.two.word && t.two.rows === 2 && t.two.fits, `案${k}：2行に入る言葉は2行で載せる（${t.two.rows}行）`)
          check(t.skip.word === '（架空）なでると喉を鳴らす' && t.skip.index === 1 && t.skip.long === 1, `案${k}：長くて2行に入らない行は飛ばして、次の行を使う`)
          check(t.none.word === null && t.none.long === 1 && t.none.fits, `案${k}：どの行も入らなければ、言葉を載せない（はみ出さない）`)
          check(t.same.word === '（架空）人懐っこい' && t.same.words.length === 1 && t.same.same === 1, `案${k}：ひとことカードと同じ行は使わない`)
          check(t.empty.word === null && t.empty.fits, `案${k}：言葉が空なら、名前と年齢・性別だけ（ツールは言葉を作らない）`)
        }
        check(r.bottomClean, '案B：言葉も上の帯に入り、下の帯（下300）には文字も写真も置かない')
        check(JSON.stringify(r.sec) === '[4,4,3,5]', `動画の猫カードは、言葉が1つなら4秒、2つなら5秒、なければ3秒（${JSON.stringify(r.sec)}）`)
        check(
          JSON.stringify(r.profile) === JSON.stringify(['推定2歳・男の子', '推定生後3か月・女の子', '男の子', '推定2歳', '']),
          `年齢と性別の1行：「男の子」「女の子」と書き、不明な項目は出さない（${JSON.stringify(r.profile)}）`,
        )
      }
    }
    check(Number(await a('data-contrast')) >= 4.5, `${label}の写真（案B）：明るいテーマ色の帯でも、文字が読みやすい（見やすさ ${await a('data-contrast')}）`)
    check(!(await p.getByRole('group', { name: '文字の位置' }).isVisible()) && (await p.getByText('文字は上の色の帯に入ります').isVisible()), `${label}の写真（案B）では、文字の位置のボタンを出さず、そのわけを出す`)
    await p.screenshot({ path: join(outDir, `5h_猫カード_${label}_案B_長い文字_明るい色.png`), fullPage: true })
  }
  // 「いいところ」が空のとき
  await p.getByRole('button', { name: '戻る' }).click()
  await p.getByRole('textbox', { name: /^名前/ }).fill('テスト')
  await p.getByLabel('いいところ').fill('')
  await p.getByRole('button', { name: '次へ' }).click()
  await p.waitForTimeout(400)
  check((await a('data-lines-total')) === '0' && (await a('data-lines-shown')) === '0' && (await a('data-fits')) === '1', '「いいところ」が空のときは、カードに空欄を作らない（名前だけ）')
  check(await p.getByText('猫カードに載せる言葉がありません。「いいところ」を1行入れると、2枚目で新しく伝わります。').isVisible(), '「いいところ」が空のときは、確認画面で知らせる')
  await p.screenshot({ path: join(outDir, '5g_猫カード_いいところなし.png'), fullPage: true })
  await p.locator('[data-notice="no-word"]').getByRole('button', { name: '入力に戻って書く' }).click()
  check(await p.getByLabel('いいところ').isVisible(), '［入力に戻って書く］で入力画面に戻る')
  await ctx.close()
}

// 表紙と最後の1枚（#5 #6）：仮の画像・架空の団体名と譲渡会
{
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(url)
  await p.getByText('はじめに').waitFor()
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p.getByLabel('団体名').fill('テスト保護猫の会')
  await p.getByLabel('連絡先').fill('（架空）Instagramのメッセージで\nお問い合わせください')
  await p.getByRole('button', { name: '登録して始める' }).click()
  const addEvents = (events) =>
    p.evaluate(
      (events) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('hogoneko-card')
          req.onsuccess = () => {
            const tx = req.result.transaction('events', 'readwrite')
            tx.objectStore('events').clear()
            for (const e of events) tx.objectStore('events').put(e)
            tx.oncomplete = () => {
              req.result.close()
              resolve(true)
            }
            tx.onerror = () => reject(tx.error)
          }
          req.onerror = () => reject(req.error)
        }),
      events,
    )
  const ymd = (days) => {
    const d = new Date(Date.now() + days * 86400000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const openPreview = async (photo) => {
    await p.getByRole('button', { name: '新しい子を紹介' }).click()
    await p.locator('input[type=file][accept="image/*"]').setInputFiles(photo)
    await p.locator('.photo img').first().waitFor()
    await p.getByRole('textbox', { name: /^名前/ }).fill('とてもながいなまえのテストねこエリザベス・ミルクティー・ショコラ・ド・マカロン三世')
    await p.getByRole('button', { name: '次へ' }).click()
    await p.locator('.card-cover[data-drawn="1"]').waitFor()
    await p.locator('.card-end[data-drawn="1"]').waitFor()
    await p.waitForTimeout(300)
  }
  const cover = p.locator('.card-cover')
  const end = p.locator('.card-end')
  // 譲渡会なし
  await openPreview(dummy('#c9b8a6', '縦', 600, 800))
  check((await cover.getAttribute('data-fits')) === '1' && Number(await cover.getAttribute('data-contrast')) >= 4.5, `表紙（縦の写真）：長い名前でも、隠れる所にかからず読める（見やすさ ${await cover.getAttribute('data-contrast')}）`)
  check((await end.getAttribute('data-event')) === '0' && (await end.getAttribute('data-fits')) === '1', '譲渡会がないとき、最後の1枚は団体名と連絡先だけで、はみ出さない')
  check(await p.getByText('次の譲渡会が登録されていないので').isVisible(), '譲渡会がないとき、そのことを確認画面に出す')
  await p.screenshot({ path: join(outDir, '5j_表紙と最後の1枚_譲渡会なし.png'), fullPage: true })
  await p.locator('.card-strip').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await p.waitForTimeout(300)
  await p.screenshot({ path: join(outDir, '5k_最後の1枚までめくった.png') })
  // 過ぎた譲渡会だけがあるとき
  // 確認画面を開くたびに譲渡会を読み直すので、入力へ戻ってから［次へ］で開き直す
  await p.getByRole('button', { name: '戻る' }).click()
  await addEvents([{ id: 'e-old', date: ymd(-1), startTime: '13:00', endTime: '16:00', venue: '（架空）過ぎた会場', catIds: [] }])
  await p.getByRole('button', { name: '次へ' }).click()
  await p.locator('.card-end[data-drawn="1"]').waitFor()
  await p.waitForTimeout(300)
  check((await end.getAttribute('data-event')) === '0', '過ぎた譲渡会は、最後の1枚に入らない')
  // これからの譲渡会があるとき（近いほうを入れる）
  await p.getByRole('button', { name: '戻る' }).click()
  await addEvents([
    { id: 'e-old', date: ymd(-1), startTime: '13:00', endTime: '16:00', venue: '（架空）過ぎた会場', catIds: [] },
    { id: 'e-far', date: ymd(30), startTime: '13:00', endTime: '16:00', venue: '（架空）遠い会場', catIds: [] },
    { id: 'e-near', date: ymd(0), startTime: '13:00', endTime: '16:00', venue: '（架空）みどり公民館 2階 和室', catIds: [] },
  ])
  await p.getByRole('button', { name: '次へ' }).click()
  await p.locator('.card-end[data-drawn="1"][data-event="1"]').waitFor({ timeout: 3000 }).catch(() => {})
  check((await end.getAttribute('data-event')) === '1' && (await end.getAttribute('data-fits')) === '1', '今日からの譲渡会があれば、最後の1枚に入り、はみ出さない')
  const box = p.getByLabel(/最後の1枚に、次の譲渡会/)
  check((await box.isVisible()) && (await p.getByText(`次の譲渡会（${ymd(0).slice(5).replace('-', '/')}）`).isVisible()), 'いちばん近い譲渡会（今日）を選び、確認画面で外せる')
  await p.screenshot({ path: join(outDir, '5l_最後の1枚_譲渡会あり.png'), fullPage: true })
  await end.click()
  await p.locator('.card-full .card-full-canvas[data-drawn="1"]').waitFor()
  await p.screenshot({ path: join(outDir, '5m_最後の1枚_画面いっぱい.png') })
  await p.getByRole('button', { name: '× 閉じる' }).click()
  await box.uncheck()
  await p.locator('.card-end[data-event="0"]').waitFor({ timeout: 3000 }).catch(() => {})
  check((await end.getAttribute('data-event')) === '0', '譲渡会を外すと、最後の1枚から消える')
  // 横の写真の表紙
  await p.getByRole('button', { name: '戻る' }).click()
  await p.getByRole('button', { name: '写真1を外す' }).click()
  await p.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#9fb3a0', '横', 800, 600))
  await p.locator('.photo img').first().waitFor()
  await p.getByRole('button', { name: '次へ' }).click()
  await p.locator('.card-cover[data-design="B"][data-drawn="1"]').waitFor({ timeout: 3000 }).catch(() => {})
  check((await cover.getAttribute('data-design')) === 'B' && (await cover.getAttribute('data-fits')) === '1' && Number(await cover.getAttribute('data-contrast')) >= 4.5, '表紙（横の写真）：色の帯に名前が入り、はみ出さず読める')
  await p.screenshot({ path: join(outDir, '5n_表紙_横の写真.png'), fullPage: true })
  await ctx.close()
}

// 案B：中くらいの明るさのテーマ色でも、帯の文字が読めるか（11/5 見直し①の1番。白でも濃い色でも4.5に届かない色）
for (const theme of ['#888888', '#5b8fb9', '#d9534f']) {
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(url)
  await p.getByText('はじめに').waitFor()
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p.getByLabel('団体名').fill('テスト保護猫の会')
  await p.locator('input[type=color]').fill(theme)
  await p.getByRole('button', { name: '登録して始める' }).click()
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  await p.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#8fa9a3', '横', 800, 600))
  await p.locator('.photo img').first().waitFor()
  await p.getByRole('textbox', { name: /^名前/ }).fill('テスト')
  await p.getByLabel('いいところ').fill('（架空）ひざの上が大好き\n（架空）ごはんの時間を教えてくれる')
  await p.getByRole('button', { name: '次へ' }).click()
  const card = p.locator('.card-canvas')
  await p.locator('.card-canvas[data-design="B"][data-drawn="1"]').waitFor()
  await p.waitForTimeout(300)
  check(Number(await card.getAttribute('data-contrast')) >= 4.5 && (await card.getAttribute('data-fits')) === '1', `案B：中くらいのテーマ色（${theme}）でも、帯の文字が読みやすく、はみ出さない（見やすさ ${await card.getAttribute('data-contrast')}）`)
  await p.screenshot({ path: join(outDir, `5i_猫カード_案B_${theme.slice(1)}.png`), fullPage: true })
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
await page.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#e8826b', 'ロゴ'))
await page.getByLabel('連絡先').fill('InstagramのDMでどうぞ')
await page.getByLabel('毎回同じ文章').fill('譲渡会は予約不要です。')
await page.getByLabel('いつものハッシュタグ').fill('#保護猫 #里親募集 #猫 #ねこ #保護猫カフェ #譲渡会 #cat')
await page.getByLabel('いつもの譲渡会場所').fill('テスト公民館')
await shot('1b_登録_入力後', true)
await page.getByRole('button', { name: '登録して始める' }).click()
await page.getByText('新しい子を紹介').waitFor()
await shot('2_ホーム')
{
  // ツールの名前は「むすび」（11/8 作者の「できれば」）。ホームの見出し・タブの名前・ホーム画面に追加したときの名前
  const mf = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json())
  const appTitle = await page.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content'))
  check((await page.locator('.hero h1').textContent()) === 'むすび' && (await page.title()) === 'むすび' && mf.name === 'むすび' && mf.short_name === 'むすび' && appTitle === 'むすび', 'ツールの名前は「むすび」（ホームの見出し・タブ・ホーム画面に追加したときの名前）')
}
check(await page.getByText('ホーム画面に追加しないと、しばらく開かないときに名簿が消えることがあります').isVisible(), '案内を飛ばした人には、ホームで名簿が消えることがあると知らせる')
// 開いてすぐ戻っただけなら、「入力の続き」にしない（見直し A9）
await page.getByRole('button', { name: '新しい子を紹介' }).click()
await page.getByRole('textbox', { name: /^名前/ }).waitFor()
await page.waitForTimeout(500)
await page.getByRole('button', { name: '戻る' }).click()
await page.getByText('新しい子を紹介').waitFor()
check(!(await page.getByText('入力の続き').isVisible()), '開いてすぐ戻っただけなら、「入力の続き」は出ない')

// 3. 入力（未入力で次へ）
await page.getByRole('button', { name: '新しい子を紹介' }).click()
await page.getByRole('button', { name: '次へ' }).click()
await shot('3a_入力_未入力')
check(await page.getByText('まだ入っていません：写真か動画、名前').isVisible(), '写真か動画と、名前がないと先へ進めない')
await shot('3b_入力_最初の状態', true)
// 欄の下の案内が、下に続くもの（次の欄の見出し・ボタン）に隠れていない（11/7 作者が見本で気にした所。下に固定のボタンは除く）
{
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('.field > small.muted')]
      .map((el) => {
        const b = el.getBoundingClientRect()
        let n = el.closest('.field')?.nextElementSibling
        while (n && (getComputedStyle(n).position === 'fixed' || n.getBoundingClientRect().height === 0)) n = n.nextElementSibling
        const nb = n?.getBoundingClientRect()
        return { text: el.textContent.slice(0, 12), bad: (nb ? b.bottom > nb.top + 0.5 : false) || el.scrollHeight > el.clientHeight + 1 }
      })
      .filter((x) => x.bad)
      .map((x) => x.text),
  )
  check(hidden.length === 0, `入力画面の欄の下の案内が、下の見出しやボタンに隠れていない（${hidden.join('・') || 'なし'}）`)
}

// 4. 入力する（手入力だけ）
await page.locator('input[type=file][accept="image/*"]').setInputFiles([dummy('#c9a27e', '写真1'), dummy('#8fa9a3', '写真2')])
await page.locator('.photo img').nth(1).waitFor()
await page.getByLabel('預かりさんからのLINE・メモ').fill('（架空のメモ）ひざの上が好きな子です。')
await page.getByRole('textbox', { name: /^名前/ }).fill('テスト')
await page.getByRole('button', { name: '生まれた年月' }).click()
await page.getByLabel('生まれた年月').fill('2026-08')
await page.getByLabel('推定').check()
await page.getByRole('group', { name: '性別' }).getByRole('button', { name: 'オス' }).click()
await page.getByRole('group', { name: 'ワクチン' }).getByRole('button', { name: '済み', exact: true }).click()
await page.locator('.health').first().getByLabel('投稿文に載せる').check()
await page.getByRole('group', { name: '猫エイズ・白血病の検査' }).getByRole('button', { name: '陰性' }).click()
await page.getByLabel('いいところ').fill('ひざの上が大好き\nごはんの時間を教えてくれる')
await page.getByLabel('見る人へのひとこと（なくてもOK）').fill('毎朝、玄関までお迎えに来てくれます。')
await shot('4_入力_入力後', true)
check(await page.getByText('今は「推定生後3か月」').isVisible(), '生まれた年月から月齢が出る（11/1時点で生後3か月）')

// 5. 入力の途中で読み込み直しても残るか（LINEに移って戻ったときの代わり）
await page.waitForTimeout(600)
await page.reload()
await page.getByRole('textbox', { name: /^名前/ }).waitFor()
check((await page.getByRole('textbox', { name: /^名前/ }).inputValue()) === 'テスト', '読み込み直しても、名前が残る')
check((await page.locator('.photo img').count()) === 2, '読み込み直しても、写真2枚が残る')
check((await page.getByLabel('いいところ').inputValue()).includes('ごはんの時間'), '読み込み直しても、いいところが残る')

// 6. 確認 → 名簿に保存
await page.getByRole('button', { name: '次へ' }).click()
await shot('5_確認_仮')
check((await page.locator('h1, .topbar h2, header').filter({ hasText: /^確認$/ }).count()) >= 1 && (await page.getByText('確認（仮）').count()) === 0, '確認の画面の題は「確認」（「（仮）」を外した。11/8 作者の決定）')
// 猫カード（仮の画像）
{
  const card = page.locator('.card-canvas')
  await page.locator('.card-canvas[data-drawn="1"]').waitFor()
  check((await card.getAttribute('data-fits')) === '1', '猫カードが描かれ、名前とカードの言葉が収まっている')
  check(Number(await card.getAttribute('data-contrast')) >= 4.5, `カードの文字が読みやすい色（見やすさ ${await card.getAttribute('data-contrast')}。4.5以上）`)
  await page.getByRole('group', { name: '文字の位置' }).getByRole('button', { name: '少し上' }).click()
  await page.waitForTimeout(300)
  check(
    (await page.getByRole('group', { name: '文字の位置' }).getByRole('button', { name: '少し上' }).getAttribute('class')).includes('chip-on'),
    '文字の位置を「少し上」に変えられる',
  )
  await shot('5d_猫カード_少し上', true)
  await card.click()
  const fullCanvas = page.locator('.card-full-canvas')
  await fullCanvas.waitFor()
  const box = await fullCanvas.boundingBox()
  const vp = page.viewportSize()
  check(
    box && box.height <= vp.height + 1 && box.width <= vp.width + 1 && Math.abs(box.width / box.height - 9 / 16) < 0.01,
    `カードを押すと、画面いっぱいに9:16のまま出る（${Math.round(box.width)}×${Math.round(box.height)}）`,
  )
  check(await page.getByRole('button', { name: '× 閉じる' }).isVisible(), '画面いっぱいの表示に「× 閉じる」が出る')
  await shot('5e_猫カード_画面いっぱい')
  await page.getByRole('button', { name: '× 閉じる' }).click()
  check(!(await fullCanvas.isVisible()), '「× 閉じる」で元の画面に戻る')
  await page.getByRole('group', { name: '文字の位置' }).getByRole('button', { name: 'ふつう' }).click()
}
const post = await page.getByLabel('投稿文（その場で直せます）').inputValue()
check((post.match(/#/g) ?? []).length === 5, `ハッシュタグを7こ登録しても、投稿文は5つまで（${(post.match(/#/g) ?? []).length}こ）`)
check(post.includes('ワクチン：済み') && !post.includes('陰性'), '健康は「載せる」を選んだものだけ投稿文に出る')
check(post.includes('推定生後3か月・オス'), '年齢と性別が投稿文に出る')
// 投稿文を直して「#」を足し、6こになったら先へ進めない
const postBox = page.getByLabel('投稿文（その場で直せます）')
await postBox.fill(post + ' ＃追加のタグ')
check(await page.getByRole('button', { name: '動画を作る' }).isDisabled(), '投稿文のハッシュタグが6こになると、先へ進めない')
await shot('5b_確認_ハッシュタグ6こ')
await postBox.fill(post)
// 手で直した投稿文は、［戻る］→［次へ］で黙って消えない（見直し A3）
await postBox.fill(post + '\n手で直した一文')
dialogAnswer = 'no'
await page.evaluate(() => (window.__confirmAnswer = 'no'))
await page.getByRole('button', { name: '戻る' }).click()
await page.evaluate(() => (window.__confirmSeen = 0))
await page.getByRole('button', { name: '次へ' }).click()
await page.waitForTimeout(400)
check((await page.evaluate(() => window.__confirmSeen)) === 1 && (await page.evaluate(() => window.__browserDialogs)) === 0, '作り直すかの確認は、ブラウザの窓ではなく、ツールの画面の中に出る（#43）')
check((await postBox.inputValue()).includes('手で直した一文'), '手で直した投稿文は、［戻る］→［次へ］でも残る（作り直すかを聞いて「いいえ」）')
dialogAnswer = 'yes'
await page.evaluate(() => (window.__confirmAnswer = 'yes'))
await page.getByRole('button', { name: '戻る' }).click()
await page.getByRole('button', { name: '次へ' }).click()
check((await postBox.inputValue()) === post, '作り直すかを聞いて「はい」なら、入力の内容で作り直す')
// 名簿への保存を、わざと失敗させる（見直し A2）
await breakStore(page, 'cats')
await page.getByRole('button', { name: '動画を作る' }).click()
await page.getByText('名簿に保存できませんでした').waitFor({ timeout: 3000 }).catch(() => {})
check(await page.getByText('名簿に保存できませんでした。もう一度押してください。').isVisible(), '名簿への保存に失敗すると、知らせが出る')
check(await seenWithoutScroll(page, page.getByText('名簿に保存できませんでした')), '名簿への保存の失敗の知らせは、スクロールしなくても見える')
check(await page.getByRole('button', { name: '動画を作る' }).isEnabled(), '名簿への保存に失敗しても、ボタンが押せる状態に戻る')
check((await postBox.inputValue()) === post, '名簿への保存に失敗しても、投稿文は消えない')
await shot('5c_確認_保存の失敗')
await page.getByRole('button', { name: '戻る' }).click()
check((await page.getByRole('textbox', { name: /^名前/ }).inputValue()) === 'テスト' && (await page.locator('.photo img').count()) === 2, '名簿への保存に失敗しても、入力した名前と写真は消えない')
await page.getByRole('button', { name: '次へ' }).click()
await fixStore(page)
await page.getByRole('button', { name: '動画を作る' }).click()
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
await page.getByRole('textbox', { name: /^名前/ }).waitFor()
check((await page.getByRole('textbox', { name: /^名前/ }).inputValue()) === 'テスト', '名簿から選ぶと、前の内容が入っている')
check(await page.getByText('今は「推定生後4か月」').isVisible(), '月齢が自動で増える（12/2には生後4か月）')
check(await page.getByText('健康情報は前回（11月1日）のものです。').isVisible(), '健康情報の知らせが出る')
await shot('9a_名簿の子_健康の知らせ', true)
await page.getByRole('button', { name: '今も正しい' }).click()
check(!(await page.getByText('健康情報は前回').isVisible()), '［今も正しい］で知らせが消える')
await shot('9b_名簿の子_確認後')

// 9. もう一度保存しても、名簿は2匹に増えない
await page.getByRole('button', { name: '次へ' }).click()
await page.getByRole('button', { name: '動画を作る' }).click()
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

// 写真を選んだときに小さくする（issue #2）。仮の画像だけ（細かいしま模様と文字）。ブラウザの中で作る
{
  // 仮の画像は、いつもChromium（大きな画像を作れる）で作る。WebKitで試すときも同じ画像を使う
  const gen = engine === chromium ? browser : await chromium.launch()
  const gp = await gen.newPage()
  const makeJpeg = async (w, h) =>
    Buffer.from(
      await gp.evaluate(
        async ([w, h]) => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = h
          const x = c.getContext('2d')
          x.fillStyle = '#c9a27e'
          x.fillRect(0, 0, w, h)
          x.fillStyle = '#3a2e26'
          for (let i = 0; i < w; i += 8) x.fillRect(i, 0, 3, h)
          x.font = `${Math.round(h / 10)}px sans-serif`
          x.fillText('仮の画像', w / 10, h / 2)
          // 写真のような細かいざらつき（単純な模様だけだと、元のファイルが本物の写真よりずっと軽くなるため）
          const d = x.getImageData(0, 0, w, h)
          let seed = 1
          for (let i = 0; i < d.data.length; i += 4) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            const n = (seed % 41) - 20
            d.data[i] += n
            d.data[i + 1] += n
            d.data[i + 2] += n
          }
          x.putImageData(d, 0, 0)
          const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
          const u = new Uint8Array(await b.arrayBuffer())
          let s = ''
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
          return btoa(s)
        },
        [w, h],
      ),
      'base64',
    )
  // JPEGの先頭に「90度回して見る」の印（EXIF Orientation=6）を入れる
  const withRotate = (jpeg) => {
    const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])
    const len = Buffer.alloc(2)
    len.writeUInt16BE(body.length + 2)
    return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), len, body, jpeg.subarray(2)])
  }
  const files = {
    縦: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(3024, 4032) },
    大: { name: 'b.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(8064, 6048) }, // 4800万画素
    回転: { name: 'c.jpg', mimeType: 'image/jpeg', buffer: withRotate(await makeJpeg(3200, 2400)) },
    壊れ: { name: 'd.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('これは画像ではありません'.repeat(50)) },
  }
  await gp.close()
  if (gen !== browser) await gen.close()

  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(url + '/?sizes=1')
  await p.getByText('はじめに').waitFor()
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p.getByLabel('団体名').fill('テスト保護猫の会')
  await p.getByRole('button', { name: '登録して始める' }).click()
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  const t0 = Date.now()
  await p.locator('input[type=file][accept="image/*"]').setInputFiles([files.縦, files.大, files.回転])
  await p.locator('.photo img').nth(2).waitFor({ timeout: 20000 })
  console.log(`  大きな仮の画像3枚を入れるまで：${((Date.now() - t0) / 1000).toFixed(1)}秒（パソコン）`)
  await p.waitForTimeout(800) // 途中の保存を待つ
  // 入力の途中として保存された写真を、保存場所から直接読んで、大きさと種類を見る
  const stored = () =>
    p.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('hogoneko-card')
          req.onsuccess = () => {
            const r = req.result.transaction('drafts').objectStore('drafts').get('photos')
            r.onsuccess = async () => {
              const out = []
              // 入力の途中の写真は {key, photos} の形（#44 から）。前の形（並びだけ）も読む
              const list = Array.isArray(r.result) ? r.result : (r.result?.photos ?? [])
              for (const s of list) {
                const blob = new Blob([s.data], { type: s.type })
                let w = 0
                let h = 0
                try {
                  const bm = await createImageBitmap(blob)
                  w = bm.width
                  h = bm.height
                } catch {}
                out.push({ type: s.type, bytes: blob.size, w, h })
              }
              resolve(out)
            }
          }
        }),
    )
  const got = await stored()
  console.log('  元の仮の画像：' + ['縦', '大', '回転'].map((k) => `${(files[k].buffer.length / 1024 / 1024).toFixed(2)}MB`).join(' / '))
  console.log('  保存された写真：' + got.map((g) => `${g.w}×${g.h}・${g.type}・${(g.bytes / 1024 / 1024).toFixed(2)}MB`).join(' / '))
  const ok = (g, w, h) => g && g.type === 'image/jpeg' && g.w === w && g.h === h
  check(ok(got[0], 1920, 2560), '大きな縦の写真（3024×4032）は、長い辺2560以下のJPEG（1920×2560）で保存される')
  check(ok(got[1], 2560, 1920), '4800万画素の写真（8064×6048）も、長い辺2560以下のJPEG（2560×1920）で保存される')
  check(ok(got[2], 1920, 2560), '「90度回して見る」の印がある写真は、回したあとの向き（縦1920×2560）で保存される')
  check(got.every((g, i) => g.bytes < files[['縦', '大', '回転'][i]].buffer.length), '小さくした写真は、元のファイルより軽い')
  check(await p.getByTestId('photo-sizes').isVisible(), '?sizes=1 で開いたときは、写真の大きさの数字が出る')
  check(await p.getByText(/^確認モード・版 [0-9a-f]{7}$/).isVisible(), '?sizes=1 で開いたときは、画面の上に「確認モード」と版の番号が出る')
  check(!(await p.getByTestId('photo-sizes').innerText()).match(/\.jpg|a\.|b\.|c\./), '大きさの数字に、写真の名前は出さない')
  await p.screenshot({ path: join(outDir, '2s_写真を小さくした_数字.png'), fullPage: true })
  // 読めない写真は、元のまま残す
  await p.getByRole('button', { name: '写真3を外す' }).click()
  await p.locator('input[type=file][accept="image/*"]').setInputFiles(files.壊れ)
  await p.waitForTimeout(1200)
  const got2 = await stored()
  const lines = (await p.getByTestId('photo-sizes').innerText()).split('\n').filter(Boolean)
  check(lines.length === 3 && lines[0].startsWith('写真1：') && lines[2].startsWith('写真3：読めなかった'), `写真を外して選び直しても、数字の行は今ある写真の分だけ（${lines.length}行）`)
  check(got2.length === 3 && got2[2].bytes === files.壊れ.buffer.length && got2[2].type === 'image/jpeg', '読めない写真は、小さくせずに元のまま残る')
  await ctx.close()
  // ?sizes=1 を付けずに開いたときは、数字を出さない
  const ctx2 = await browser.newContext({ ...phone })
  const p2 = await ctx2.newPage()
  await p2.goto(url)
  await p2.getByText('はじめに').waitFor()
  await p2.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p2.getByLabel('団体名').fill('テスト保護猫の会')
  await p2.getByRole('button', { name: '登録して始める' }).click()
  await p2.getByRole('button', { name: '新しい子を紹介' }).click()
  await p2.locator('input[type=file][accept="image/*"]').setInputFiles(files.縦)
  await p2.locator('.photo img').first().waitFor({ timeout: 10000 })
  check((await p2.getByTestId('photo-sizes').count()) === 0, '?sizes=1 を付けずに開いたときは、大きさの数字を出さない')
  check((await p2.getByText('確認モード').count()) === 0, '?sizes=1 を付けずに開いたときは、「確認モード」を出さない')
  await ctx2.close()
}

// ひとことカード（#28）：書き換えずに載せる。長くて入らないときは知らせて、投稿文にだけ載せるか、載せる文を選ぶ
{
  const ctx6 = await browser.newContext({ ...phone })
  const p6 = await ctx6.newPage()
  await p6.goto(url + '/?sizes=1')
  await p6.getByText('はじめに').waitFor()
  await p6.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p6.getByLabel('団体名').fill('テスト保護猫の会')
  await p6.getByRole('button', { name: '登録して始める' }).click()
  await p6.getByRole('button', { name: '新しい子を紹介' }).click()
  await p6.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#c9b8a6', '写真'))
  await p6.locator('.photo img').first().waitFor()
  await p6.getByRole('textbox', { name: /^名前/ }).fill('テスト')
  await p6.getByLabel(/見る人へのひとこと/).fill('（架空）毎朝お迎えに来てくれて、癒されています。')
  await p6.getByRole('button', { name: '次へ' }).click()
  await p6.locator('.card-words[data-drawn="1"]').waitFor({ timeout: 5000 }).catch(() => {})
  const caps = await p6.locator('.card-slot figcaption').allInnerTexts()
  check(caps.join('・') === '1 表紙・2 猫カード・3 ひとこと・4 最後の1枚' && (await p6.locator('.card-words').getAttribute('data-fits')) === '1', `ひとことがあると、猫カードと最後の1枚のあいだにひとことカードが入る（${caps.join('・')}）`)
  await p6.locator('.card-strip').evaluate((el) => el.scrollTo({ left: el.scrollWidth * 0.55 }))
  await p6.waitForTimeout(300)
  await p6.screenshot({ path: join(outDir, '5o_ひとことカード.png') })
  // ひとことの秒数は2秒＋行数（11/8 から文字が60pxなので、この文は3行）。動画を作る前に、カードの行数を読んでおく
  const wl = Number(await p6.locator('.card-words').getAttribute('data-lines'))
  await p6.getByRole('button', { name: '動画を作る' }).click()
  await p6.locator('.reel-video').waitFor({ timeout: 60000 })
  const d1 = await p6.locator('.reel-video').evaluate(async (v) => (v.duration || (await new Promise((r) => v.addEventListener('loadedmetadata', () => r(v.duration), { once: true })))))
  const want1 = 3 + 3 + Math.min(6, Math.max(3, 2 + wl)) + 4
  check(wl >= 2 && Math.abs(d1 - want1) < 0.2, `動画に、ひとことカードが入る（表紙3＋猫カード3＋ひとこと${wl}行で${2 + wl}秒＋最後の1枚4＝${want1}秒。${d1}秒）`)
  // 長いひとこと
  await p6.getByRole('button', { name: '名簿を見る' }).click()
  await p6.getByText('テスト').first().click()
  const long = Array.from({ length: 14 }, (_, i) => `（架空）${i + 1}つめの文です、毎日いろいろなことをして楽しく過ごしています。`).join('')
  await p6.getByLabel(/見る人へのひとこと/).fill(long)
  await p6.getByRole('button', { name: '次へ' }).click()
  await p6.waitForTimeout(800)
  check((await p6.getByText('ひとことが長くて、カードに入りきりません').isVisible()) && (await p6.locator('.card-words').count()) === 0, '長くて入らないときは知らせて、カードには載せない（投稿文にだけ載せる）')
  check((await p6.getByLabel('投稿文（その場で直せます）').inputValue()).includes('14つめの文です'), '長いひとことも、投稿文には全部入る')
  await p6.screenshot({ path: join(outDir, '5p_ひとことが長い.png'), fullPage: true })
  const boxes = p6.locator('.words-pick input[type=checkbox]')
  check((await boxes.count()) === 14, `載せる文を、文ごとに選べる（${await boxes.count()}文）`)
  await boxes.nth(0).check()
  await boxes.nth(2).check()
  await p6.waitForTimeout(500)
  check((await p6.getByText('選んだ文も、まだ入りきりません').isVisible()) && (await p6.locator('.card-words').count()) === 0, '選んだ文が4行を超えるときは、まだ入らないと知らせる（カードには載せない）')
  await boxes.nth(0).uncheck()
  await boxes.nth(2).uncheck()
  await boxes.nth(0).check()
  await p6.locator('.card-words[data-drawn="1"]').waitFor({ timeout: 5000 }).catch(() => {})
  check((await p6.locator('.card-words').count()) === 1 && (await p6.locator('.card-words').getAttribute('data-fits')) === '1', '選んだ文だけでカードに入る')
  await p6.screenshot({ path: join(outDir, '5q_ひとこと_文を選んだ.png'), fullPage: true })
  await p6.getByRole('button', { name: '投稿文にだけ載せる' }).click()
  await p6.waitForTimeout(300)
  check((await p6.locator('.card-words').count()) === 0, '［投稿文にだけ載せる］で、カードから外れる')
  await ctx6.close()
}

// ひとこと・最後の1枚（11/6夜 作者の決定：便箋なし。縦の写真は写真の上に白い文字、横・正方形は帯）：写真の使い分け・譲渡会なし・ロゴあり・ひとことの長さ
{
  const ctx7 = await browser.newContext({ ...phone })
  const p7 = await ctx7.newPage()
  await p7.goto(url + '/?sizes=1')
  await p7.getByText('はじめに').waitFor()
  await p7.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p7.getByLabel('団体名').fill('（架空）とても長い名前の保護猫の会・ねこのおうち探しプロジェクト')
  await p7.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#5b8fb9', 'ロゴ', 300, 300))
  await p7.getByLabel('連絡先').fill('（架空）Instagramのメッセージでお問い合わせください\n（架空）メール：example@example.com\n（架空）電話：00-0000-0000（平日10時〜17時）')
  await p7.getByRole('button', { name: '登録して始める' }).click()
  await p7.getByRole('button', { name: '新しい子を紹介' }).click()
  const words = p7.locator('.card-words')
  const end = p7.locator('.card-end')
  const photos = async (n) => {
    const labels = ['写真A', '写真B', '写真C']
    for (let i = 0; i < n; i++) {
      await p7.locator('input[type=file][accept="image/*"]').setInputFiles(dummy(['#c9b8a6', '#9fb3a0', '#b3a0c9'][i], labels[i]))
      await p7.locator('.photo img').nth(i).waitFor()
    }
  }
  await photos(1)
  await p7.getByRole('textbox', { name: /^名前/ }).fill('テスト')
  await p7.getByLabel(/見る人へのひとこと/).fill('（架空）毎日癒されています。')
  const look = async () => {
    await p7.getByRole('button', { name: '次へ' }).click()
    await p7.locator('.card-words[data-drawn="1"]').waitFor({ timeout: 5000 }).catch(() => {})
    await p7.locator('.card-end[data-drawn="1"]').waitFor({ timeout: 5000 }).catch(() => {})
    await p7.waitForTimeout(400)
    return `${await words.getAttribute('data-photo')}/${await end.getAttribute('data-photo')}`
  }
  check((await look()) === '0/0', '写真1枚：ひとことも最後の1枚も1枚目')
  // 写真が、ぼかしではなく、そのままの色で描かれているか（写真A＝#c9b8a6。11/6 境目をなめらかにしたときに写真が消えた失敗を受けて足した）
  for (const [name, loc] of [['ひとこと', words], ['最後の1枚', end]]) {
    const px = await loc.evaluate((c) => [...c.getContext('2d').getImageData(200, 500, 1, 1).data].slice(0, 3))
    check(Math.abs(px[0] - 0xc9) <= 6 && Math.abs(px[1] - 0xb8) <= 6 && Math.abs(px[2] - 0xa6) <= 6, `${name}の上に、写真がそのままの色で描かれる（${px.join(',')}）`)
  }
  check((await end.getAttribute('data-event')) === '0' && (await end.getAttribute('data-fits')) === '1', '譲渡会がなく、ロゴと長い団体名・3行の連絡先でも、最後の1枚がはみ出さない')
  await p7.screenshot({ path: join(outDir, '5r_ひとこと最後_写真1枚.png') })
  await end.click()
  await p7.locator('.card-full .card-full-canvas[data-drawn="1"]').waitFor()
  await p7.screenshot({ path: join(outDir, '5s_最後の1枚_ロゴ_譲渡会なし.png') })
  await p7.getByRole('button', { name: '× 閉じる' }).click()
  await p7.getByRole('button', { name: '戻る' }).click()
  await photos(0)
  await p7.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#9fb3a0', '写真B'))
  await p7.locator('.photo img').nth(1).waitFor()
  check((await look()) === '0/1', '写真2枚：ひとことは1枚目、最後の1枚は2枚目')
  await p7.getByRole('button', { name: '戻る' }).click()
  await p7.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#b3a0c9', '写真C'))
  await p7.locator('.photo img').nth(2).waitFor()
  check((await look()) === '2/0', '写真3枚：ひとことは3枚目、最後の1枚は1枚目')
  // ひとことの長さ：4行まで（11/6夜 作者の決定）。文字は60px（11/8）。60字・75字ほどは小さくして入る（文節で折ると入らないときは前の折り方で。11/8）、それより長いと知らせる
  await p7.getByRole('button', { name: '戻る' }).click()
  const len = async (n) => {
    const t = ('（架空）' + 'まいにちげんかんまでおむかえにきてくれます。'.repeat(10)).slice(0, n - 1) + '。'
    await p7.getByLabel(/見る人へのひとこと/).fill(t)
    await p7.getByRole('button', { name: '次へ' }).click()
    await p7.waitForTimeout(700)
    const r = (await words.count()) ? `${await words.getAttribute('data-size')}px・${await words.getAttribute('data-lines')}行` : (await p7.getByText('ひとことが長くて、カードに入りきりません').isVisible()) ? 'カードなし・知らせあり' : 'カードなし・知らせなし'
    await p7.getByRole('button', { name: '戻る' }).click()
    return r
  }
  const r60 = await len(60)
  check(parseInt(r60) >= 42 && /・[1-4]行$/.test(r60), `ひとこと60字は、4行までに入る（${r60}）`)
  const r75 = await len(75)
  check(/^4[24]px・4行/.test(r75), `ひとこと75字は、小さくして4行で入る（${r75}）`)
  const r100 = await len(100)
  check(r100 === 'カードなし・知らせあり', `ひとこと100字は、カードに載せず知らせる（${r100}）`)
  // 改行はそのまま生かす。4行までなら入り、5行なら知らせる
  const rows = async (n) => {
    await p7.getByLabel(/見る人へのひとこと/).fill(Array.from({ length: n }, (_, i) => `（架空）${i + 1}行目です`).join('\n'))
    await p7.getByRole('button', { name: '次へ' }).click()
    await p7.waitForTimeout(700)
    const r = (await words.count()) ? `${await words.getAttribute('data-lines')}行・${await words.getAttribute('data-sec')}秒` : 'カードなし'
    await p7.getByRole('button', { name: '戻る' }).click()
    return r
  }
  const k4 = await rows(4)
  check(k4 === '4行・6秒', `改行した4行は、4行のまま入り、6秒（${k4}）`)
  const k1 = await rows(1)
  check(k1 === '1行・3秒', `1行なら3秒（${k1}）`)
  const k5 = await rows(5)
  check(k5 === 'カードなし', `改行した5行は、カードに載せず知らせる（${k5}）`)
  await ctx7.close()
}

// #44：入力の途中の写真の書き込み。写真の中身を読むのを、わざと4秒遅らせて試す
{
  const ctx8 = await browser.newContext({ ...phone })
  const p8 = await ctx8.newPage()
  await p8.addInitScript(() => {
    const orig = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = async function () {
      if (window.__slowPhotos && this.type.startsWith('image/')) await new Promise((r) => setTimeout(r, 4000))
      return orig.call(this)
    }
  })
  const slow = (on) => p8.evaluate((on) => (window.__slowPhotos = on), on)
  await p8.goto(url + '/?sizes=1')
  await p8.getByText('はじめに').waitFor()
  await p8.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p8.getByLabel('団体名').fill('テスト保護猫の会')
  await p8.getByRole('button', { name: '登録して始める' }).click()
  await p8.getByRole('button', { name: '新しい子を紹介' }).click()
  await p8.getByRole('textbox', { name: /^名前/ }).fill('テスト')
  const add = async (color, label, n) => {
    await p8.locator('input[type=file][accept="image/*"]').setInputFiles(dummy(color, label))
    await p8.locator('.photo img').nth(n - 1).waitFor()
    await p8.waitForTimeout(100)
  }
  const reopen = async () => {
    await p8.reload()
    await p8.getByRole('textbox', { name: /^名前/ }).waitFor()
    await p8.waitForTimeout(1000)
  }
  await add('#c9b8a6', '写真A', 1)
  await p8.waitForTimeout(1200) // 写真Aは書き終わる
  // (a) 写真Bを足し、その書き込みが終わる前に閉じる
  await slow(true)
  await add('#9fb3a0', '写真B', 2)
  await p8.waitForTimeout(800) // 文字の途中の記録は書かれる。写真の書き込みはまだ
  await slow(false)
  await reopen()
  check((await p8.locator('.photo img').count()) === 1 && (await p8.getByText('写真が、前に選んだものに戻っているかもしれません').isVisible()), '写真を足した直後に閉じたときは、前の写真の組で開き、黙らずに知らせる（#44）')
  await p8.screenshot({ path: join(outDir, '3h_写真が前の組に戻ったかもしれない.png') })
  // (b) 遅い書き込み（写真2枚）のあとに、速い書き込み（写真1枚）が先に終わっても、あとの1枚が残る
  await p8.waitForTimeout(4500)
  await slow(true)
  await add('#b3a0c9', '写真C', 2)
  await slow(false)
  await p8.getByRole('button', { name: '写真2を外す' }).click()
  await p8.waitForTimeout(6000) // 遅い書き込みも終わるまで待つ
  await reopen()
  check((await p8.locator('.photo img').count()) === 1 && !(await p8.getByText('写真が、前に選んだものに戻っているかもしれません').isVisible()), 'あとで選んだ写真の組が残る（遅い書き込みが、あとの書き込みを上書きしない。#44）')
  await ctx8.close()
}

// 見直し③（#44 の直しの見直し）で見つかった場面。写真の中身を読むのを遅くしたり、文字の記録を書けなくしたりして、ページが落ちた代わりにする
{
  const ctx9 = await browser.newContext({ ...phone })
  const p9 = await ctx9.newPage()
  await p9.addInitScript(() => {
    const orig = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = async function () {
      if (window.__slowPhotos && this.type.startsWith('image/')) await new Promise((r) => setTimeout(r, 4000))
      return orig.call(this)
    }
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (v, key) {
      if (window.__blockMain && this.name === 'drafts' && key === 'main') throw new DOMException('文字の記録を書く前にページが落ちた代わり', 'AbortError')
      return put.call(this, v, key)
    }
  })
  const set = (k, v) => p9.evaluate(([k, v]) => (window[k] = v), [k, v])
  const widths = () => p9.locator('.photo img').evaluateAll((els) => els.map((e) => e.naturalWidth))
  const notice = () => p9.getByText('写真が、前に選んだものに戻っているかもしれません').isVisible()
  const reopen = async () => {
    await set('__blockMain', false)
    await p9.reload()
    await p9.waitForTimeout(1200)
  }
  await p9.goto(url + '/?sizes=1')
  await p9.getByText('はじめに').waitFor()
  await p9.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p9.getByLabel('団体名').fill('テスト保護猫の会')
  await p9.getByRole('button', { name: '登録して始める' }).click()
  // 中6：新しい子で、最初の写真を書き終える前に閉じたら、写真なしで黙って開かず、知らせる
  await p9.getByRole('button', { name: '新しい子を紹介' }).click()
  await p9.getByRole('textbox', { name: /^名前/ }).fill('みなおし')
  await p9.waitForTimeout(600)
  await set('__slowPhotos', true)
  await p9.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#c9b8a6', '写真1', 601, 800))
  await p9.locator('.photo img').first().waitFor()
  await p9.waitForTimeout(800)
  await set('__slowPhotos', false)
  await reopen()
  check(await notice(), '新しい子で最初の写真を書き終える前に閉じたら、知らせる（見直し③の中6）')
  // 名簿の子を作る（写真3枚。幅で見分ける）
  for (const [w, c] of [[602, '#9fb3a0'], [603, '#b3a0c9']]) {
    await p9.locator('input[type=file][accept="image/*"]').setInputFiles(dummy(c, `写真${w}`, w, 800))
    await p9.waitForTimeout(300)
  }
  await p9.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#c9b8a6', '写真601', 601, 800))
  await p9.waitForTimeout(500)
  const ws = await widths()
  await p9.getByRole('button', { name: '次へ' }).click()
  await p9.getByRole('button', { name: '動画を作る' }).click()
  await p9.getByText('名簿に保存しました').waitFor()
  await p9.getByRole('button', { name: 'ホームへ' }).click()
  const openRoster = async () => {
    await p9.getByRole('button', { name: /名簿から選ぶ/ }).click()
    await p9.getByText('みなおし').first().click()
    await p9.locator('.photo img').nth(ws.length - 1).waitFor()
    await p9.waitForTimeout(800)
  }
  // 重い1：名簿の子で写真を外し、写真は書き終わったが、文字の記録を書く前に落ちた → 外したまま開く
  await openRoster()
  await p9.getByRole('textbox', { name: /^名前/ }).fill('みなおしA')
  await p9.waitForTimeout(800)
  await set('__blockMain', true)
  await p9.getByRole('button', { name: '写真2を外す' }).click()
  await p9.waitForTimeout(800)
  await reopen()
  check((await widths()).length === ws.length - 1 && !(await notice()), `名簿の子で写真を外した直後に落ちても、外したまま開く（見直し③の重い1。${(await widths()).join(',')}）`)
  // 重い2：名簿の子で「表紙にする」の書き込みを終える前に閉じた → 並べ替えたまま（名簿の写真から作り直す）
  await p9.getByRole('button', { name: '戻る' }).click()
  await openRoster().catch(() => {})
  await p9.getByRole('textbox', { name: /^名前/ }).fill('みなおしB')
  await p9.waitForTimeout(800)
  const before = await widths()
  await set('__slowPhotos', true)
  await p9.getByRole('button', { name: '表紙にする' }).last().click()
  await p9.waitForTimeout(800)
  await set('__slowPhotos', false)
  await reopen()
  const after = await widths()
  check(after[0] === before[before.length - 1] && after.length === before.length, `名簿の子で「表紙にする」の直後に閉じても、並べ替えたまま開く（見直し③の重い2。${before.join(',')} → ${after.join(',')}）`)
  // 中4：何も変えずに、すぐ開き直しても、知らせは出ない
  await p9.waitForTimeout(4500)
  await reopen()
  await reopen()
  check(!(await notice()), '何も変えずに開き直しても、「前に選んだものに戻っているかも」は出ない（見直し③の中4）')
  // 中5：名簿にない写真を足し、書き終える前に確認画面で閉じた → 確認画面でも知らせる
  //    （名簿の写真を外しただけなら、名簿の写真から作り直せるので知らせない）
  await p9.getByRole('button', { name: '写真1を外す' }).click()
  await p9.waitForTimeout(1200)
  await set('__slowPhotos', true)
  await p9.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#e8826b', '写真604', 604, 800))
  await p9.locator('.photo img').nth(2).waitFor()
  await p9.getByRole('button', { name: '次へ' }).click()
  await p9.waitForTimeout(800)
  await set('__slowPhotos', false)
  await reopen()
  check(await p9.getByText('写真が、前に選んだものに戻っているかもしれません。［戻る］で写真を確かめてください。').isVisible(), '確認画面で開き直したときも、知らせる（見直し③の中5）')
  await ctx9.close()
}

// #29 写真を指で動かす（猫カードの案A・ひとこと・最後の1枚）。左が赤・右が青の仮の写真で、動かすとカードの色が変わるかを見る
{
  const ctx10 = await browser.newContext({ ...phone })
  const p10 = await ctx10.newPage()
  await p10.goto(url + '/?sizes=1')
  await p10.getByText('はじめに').waitFor()
  await p10.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p10.getByLabel('団体名').fill('テスト保護猫の会')
  await p10.getByRole('button', { name: '登録して始める' }).click()
  await p10.getByRole('button', { name: '新しい子を紹介' }).click()
  const half = { name: 'half.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="300" height="800" fill="#d04040"/><rect x="300" width="300" height="800" fill="#4060d0"/></svg>') }
  await p10.locator('input[type=file][accept="image/*"]').setInputFiles(half)
  await p10.locator('.photo img').first().waitFor()
  await p10.getByRole('textbox', { name: /^名前/ }).fill('うごかす')
  await p10.getByLabel(/見る人へのひとこと/).fill('（架空）毎日癒されています。')
  await p10.getByRole('button', { name: '次へ' }).click()
  await p10.locator('.card-canvas[data-drawn="1"]').waitFor()
  await p10.waitForTimeout(500)
  const px = (loc, x, y) => loc.evaluate((c, [x, y]) => [...c.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3), [x, y])
  const isRed = (c) => c[0] > c[2]
  const card = p10.locator('.card-canvas')
  const before = await px(card, 500, 600)
  const buttons = p10.getByRole('button', { name: '写真を動かす' })
  check((await buttons.count()) === 4, `表紙・猫カード（縦の写真）・ひとこと・最後の1枚に［写真を動かす］が出る（${await buttons.count()}こ。表紙は11/8に足した）`)
  await buttons.nth(1).click()
  const ed = p10.locator('.framing-canvas')
  await ed.waitFor()
  await p10.waitForTimeout(400)
  await p10.screenshot({ path: join(outDir, '5t_写真を動かす画面.png') })
  const box = await ed.boundingBox()
  await p10.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await p10.mouse.down()
  await p10.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 6 })
  await p10.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 6 })
  await p10.mouse.up()
  await p10.waitForTimeout(300)
  check(Number(await ed.getAttribute('data-x')) < 0, `1本指（マウス）で動かすと、写真が動く（x ${await ed.getAttribute('data-x')}）`)
  await p10.getByRole('button', { name: '大きく' }).click()
  await p10.waitForTimeout(200)
  check(Number(await ed.getAttribute('data-scale')) > 1, `［大きく］で写真が大きくなる（${await ed.getAttribute('data-scale')}倍）`)
  await p10.getByRole('button', { name: 'この位置にする' }).click()
  await p10.waitForTimeout(600)
  const after = await px(card, 500, 600)
  check(isRed(before) && !isRed(after), `動かした位置が、猫カードに入る（${before.join(',')} → ${after.join(',')}）`)
  await p10.waitForTimeout(800)
  await p10.reload()
  await p10.locator('.card-canvas[data-drawn="1"]').waitFor({ timeout: 5000 }).catch(() => {})
  await p10.waitForTimeout(600)
  check(!isRed(await px(card, 500, 600)), '読み込み直しても、動かした位置が残る（入力の途中に残る）')
  // 表紙でも動かせる（11/8 作者の「できれば」。猫カードと同じ形）
  const coverThumb = p10.locator('.card-cover')
  const cBefore = await px(coverThumb, 500, 600)
  await p10.getByRole('button', { name: '写真を動かす' }).nth(0).click()
  await ed.waitFor()
  check((await p10.getByText('表紙').count()) > 0, '表紙の［写真を動かす］で、表紙を動かす画面が開く')
  {
    const b = await ed.boundingBox()
    await p10.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await p10.mouse.down()
    await p10.mouse.move(b.x + b.width / 2 - 150, b.y + b.height / 2, { steps: 8 })
    await p10.mouse.up()
  }
  await p10.waitForTimeout(300)
  await p10.getByRole('button', { name: '大きく' }).click()
  await p10.getByRole('button', { name: 'この位置にする' }).click()
  await p10.waitForTimeout(600)
  const cAfter = await px(coverThumb, 500, 600)
  check(isRed(cBefore) && !isRed(cAfter), `動かした位置が、表紙に入る（${cBefore.join(',')} → ${cAfter.join(',')}）`)
  // 作者の絵（11/8）：縦の写真の表紙の右上には、もう何も描かない（角の絵はやめた）
  {
    const c = await px(coverThumb, 941, 315)
    const light = c[0] > 230 && c[1] > 225 && c[2] > 210
    check(!light, `角の絵はやめた：表紙の右上に描かない（${c.join(',')}）`)
  }
  // ひとことカードでも動かせる。［もとに戻す］で戻る
  await p10.getByRole('button', { name: '写真を動かす' }).nth(2).click()
  await ed.waitFor()
  const box2 = await ed.boundingBox()
  await p10.mouse.move(box2.x + box2.width / 2, box2.y + box2.height * 0.3)
  await p10.mouse.down()
  await p10.mouse.move(box2.x + box2.width / 2 - 150, box2.y + box2.height * 0.3, { steps: 8 })
  await p10.mouse.up()
  await p10.waitForTimeout(300)
  check(Number(await ed.getAttribute('data-x')) < 0, 'ひとことカードの写真も動かせる')
  await p10.getByRole('button', { name: 'もとに戻す' }).click()
  await p10.waitForTimeout(300)
  check((await ed.getAttribute('data-x')) === '0' && (await ed.getAttribute('data-scale')) === '1.00', '［もとに戻す］で、最初の位置に戻る')
  await p10.getByRole('button', { name: 'やめる' }).click()
  check(!(await ed.isVisible()), '［やめる］で、動かす画面が閉じる')
  // 動画にも、動かした位置が入る（猫カードの3秒のあいだのコマで見る）
  await p10.getByRole('button', { name: '動画を作る' }).click()
  await p10.locator('.reel-video').waitFor({ timeout: 60000 })
  const vpx = await p10.locator('.reel-video').evaluate(async (v) => {
    v.pause()
    v.currentTime = 4.5 // 表紙3秒のあと、猫カード（3〜6秒）
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }))
    const c = document.createElement('canvas')
    c.width = 1080
    c.height = 1920
    c.getContext('2d').drawImage(v, 0, 0, 1080, 1920)
    return [...c.getContext('2d').getImageData(500, 600, 1, 1).data].slice(0, 3)
  }).catch(() => null)
  if (vpx) check(!isRed(vpx), `動画の猫カードにも、動かした位置が入る（${vpx.join(',')}）`)
  const vcover = await p10.locator('.reel-video').evaluate(async (v) => {
    v.pause()
    v.currentTime = 1.5 // 表紙（0〜3秒）
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }))
    const c = document.createElement('canvas')
    c.width = 1080
    c.height = 1920
    c.getContext('2d').drawImage(v, 0, 0, 1080, 1920)
    return [...c.getContext('2d').getImageData(500, 600, 1, 1).data].slice(0, 3)
  }).catch(() => null)
  if (vcover) check(!isRed(vcover), `動画の表紙にも、動かした位置が入る（${vcover.join(',')}）`)
  await ctx10.close()
}

// 確認モードの合図は、日本語のキーボードで打った全角（？sizes＝１）でも読む（11/5夜 iPhoneで見つけた）
{
  const ctx5 = await browser.newContext({ ...phone })
  const p5 = await ctx5.newPage()
  for (const q of ['/%EF%BC%9Fsizes%EF%BC%9D%EF%BC%91', '/?sizes%EF%BC%9D1', '/?sizes=1']) {
    await p5.goto(url + q)
    await p5.waitForTimeout(500)
    check(await p5.getByText('確認モード').isVisible(), `確認モードの合図を読む（${decodeURIComponent(q)}）`)
  }
  await p5.goto(url + '/?sizes=10')
  await p5.waitForTimeout(500)
  check(!(await p5.getByText('確認モード').isVisible()), '「?sizes=10」のような別の数では、確認モードにしない')
  await ctx5.close()
}

// 確認の知らせ（#43）：ツールの画面の中に出て、［やめる］なら何も消えない。ブラウザの窓は出ない
{
  const ctx4 = await browser.newContext({ ...phone })
  const p4 = await ctx4.newPage()
  await p4.goto(url)
  await p4.getByText('はじめに').waitFor()
  await p4.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p4.getByLabel('団体名').fill('テスト保護猫の会')
  await p4.getByRole('button', { name: '登録して始める' }).click()
  await p4.getByRole('button', { name: '新しい子を紹介' }).click()
  await p4.locator('input[type=file][accept="image/*"]').setInputFiles(dummy('#c9b8a6', '写真'))
  await p4.locator('.photo img').first().waitFor()
  await p4.getByRole('textbox', { name: /^名前/ }).fill('確認の子')
  await p4.waitForTimeout(500)
  await p4.getByRole('button', { name: '戻る' }).click()
  await p4.evaluate(() => (window.__confirmManual = true))
  await p4.getByRole('button', { name: '新しい子を紹介' }).click()
  const dlg = p4.getByRole('alertdialog')
  await dlg.waitFor({ timeout: 3000 }).catch(() => {})
  check(await dlg.isVisible(), '入力の途中があるときの確認が、ツールの画面の中に出る')
  check((await seenWithoutScroll(p4, p4.locator('[data-confirm="yes"]'))) && (await seenWithoutScroll(p4, p4.locator('[data-confirm="no"]'))), '確認の2つのボタンが、スクロールしなくても見える')
  await p4.screenshot({ path: join(outDir, '7a_確認の知らせ_入力の途中.png') })
  await p4.locator('[data-confirm="no"]').click()
  await p4.waitForTimeout(300)
  check(!(await dlg.isVisible()) && (await p4.getByText('入力の続き').isVisible()), '［やめる］を押すと、知らせが消え、入力の途中も残る')
  // 名簿から消すときの確認
  await p4.getByRole('button', { name: '入力の続き' }).click()
  await p4.getByRole('button', { name: '次へ' }).click()
  await p4.getByRole('button', { name: '動画を作る' }).click()
  await p4.getByText('名簿に保存しました').waitFor()
  await p4.getByRole('button', { name: '名簿を見る' }).click()
  await p4.getByRole('button', { name: '確認の子を名簿から消す' }).click()
  await dlg.waitFor({ timeout: 3000 }).catch(() => {})
  check(await dlg.getByText('確認の子を名簿から消しますか？元に戻せません。').isVisible(), '名簿から消すときの確認が、ツールの画面の中に出る')
  await p4.screenshot({ path: join(outDir, '7b_確認の知らせ_名簿から消す.png') })
  await p4.locator('[data-confirm="no"]').click()
  await p4.waitForTimeout(300)
  check(await p4.getByRole('button', { name: '確認の子を名簿から消す' }).isVisible(), '［やめる］なら、名簿から消さない')
  // #42：名簿の子を開いて何も変えずに戻ったら、「入力の続き」も確認の知らせも出さない
  await p4.getByText('確認の子').first().click()
  await p4.getByRole('textbox', { name: /^名前/ }).waitFor()
  await p4.waitForTimeout(700)
  await p4.getByRole('button', { name: '戻る' }).click()
  check(!(await p4.getByText('入力の続き').isVisible()), '名簿の子を開いて何も変えずに戻ったら、「入力の続き」は出ない（#42）')
  await p4.evaluate(() => (window.__confirmSeen = 0))
  await p4.getByRole('button', { name: '新しい子を紹介' }).click()
  await p4.waitForTimeout(400)
  check(!(await dlg.isVisible()) && (await p4.getByRole('textbox', { name: /^名前/ }).inputValue()) === '', 'そのあと別の子を開いても、確認の知らせは出ない（#42）')
  await p4.getByRole('button', { name: '戻る' }).click()
  // 1つでも変えたら、今までどおり入力の途中として残す
  await p4.getByRole('button', { name: /名簿から選ぶ/ }).click()
  await p4.getByText('確認の子').first().click()
  await p4.getByRole('button', { name: 'オス' }).click()
  await p4.waitForTimeout(700)
  await p4.getByRole('button', { name: '戻る' }).click()
  await p4.getByText('入力の続き').waitFor({ timeout: 3000 }).catch(() => {}) // ［戻る］は入力を確定してから1拍おいて進む
  check(await p4.getByText('入力の続き').isVisible(), '名簿の子で1つでも変えて戻ったら、「入力の続き」が出る（#42）')
  await p4.getByRole('button', { name: '新しい子を紹介' }).click()
  await dlg.waitFor({ timeout: 3000 }).catch(() => {})
  check(await dlg.isVisible(), '変えたあとに別の子を開くときは、今までどおり確認の知らせが出る（#42）')
  await p4.locator('[data-confirm="yes"]').click()
  await p4.getByRole('button', { name: '戻る' }).click()
  await p4.getByRole('button', { name: /名簿から選ぶ/ }).click()
  await p4.getByRole('button', { name: '確認の子を名簿から消す' }).click()
  await p4.locator('[data-confirm="yes"]').click()
  await p4.waitForTimeout(500)
  check(!(await p4.getByRole('button', { name: '確認の子を名簿から消す' }).isVisible()), '［消す］なら、名簿から消える')
  check((await p4.evaluate(() => window.__browserDialogs)) === 0, 'ブラウザの確認の窓は、一度も出ない')
  await ctx4.close()
}

// 横の動画に重ねる名前：映像の下の端をまたがず、上の帯に収める（11/6 作者が見本で気づいた）
{
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  await p.goto(url)
  const r = await p.evaluate(async () => {
    try {
      const m = await import('/src/lib/card.ts')
      const c = document.createElement('canvas')
      c.width = 1080
      c.height = 1920
      const x = c.getContext('2d')
      const out = {}
      for (const [k, w, h] of [['16:9', 1920, 1080], ['4:3', 1440, 1080], ['正方形', 1080, 1080], ['ほぼ正方形', 1080, 1150]]) {
        const dh = (1080 * h) / w
        const area = { top: (1920 - dh) / 2, bottom: (1920 + dh) / 2 }
        const n = m.drawClipName(x, 'とてもながいなまえのテストねこ', area)
        // 名前の下に年齢と性別（11/6 作者の決定）。その行まで入れて、映像の端をまたがない
        const np = m.drawClipName(x, 'とてもながいなまえのテストねこ', area, undefined, '推定2歳・男の子')
        out[k] = { area, n, np }
      }
      out.tall = m.drawClipName(x, 'ミント', null)
      out.tallP = m.drawClipName(x, 'ミント', null, undefined, '推定2歳・男の子')
      out.tallE = m.drawClipName(x, 'ミント', null, undefined, '')
      // 明るい黄色のテーマ色：帯は選んだ色のまま、年齢と性別まで濃い色の文字で描かれる（11/8 作者の決定）
      const yb = m.bandColors('#f5d547')
      const y = document.createElement('canvas')
      y.width = 1080
      y.height = 1920
      const yx = y.getContext('2d')
      yx.fillStyle = yb.band
      yx.fillRect(0, 0, 1080, 1920)
      const yr = m.drawClipName(yx, 'ミント', { top: 660, bottom: 1260 }, { text: yb.color, pattern: false }, '推定2歳・男の子')
      const d = yx.getImageData(0, Math.round(yr.bottom - 50), 1080, 50).data
      let ink = 0
      // 年齢と性別の行は、少し透ける濃い色で描く。暗い所（どの色も120より暗い）を文字とみなす
      for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) ink++
      out.yellowProf = ink
      out.yellowBand = yb
      return out
    } catch {
      return null // 本番と同じ作りでは、部品を直接読めない
    }
  })
  if (r) {
    for (const k of ['16:9', '4:3', '正方形', 'ほぼ正方形']) {
      const { area, n } = r[k]
      const clear = n.bottom <= area.top || (n.top >= area.top && n.bottom <= area.bottom)
      check(clear && n.top >= 220 && n.bottom <= 1380, `${k}の動画：名前が映像の端をまたがず、隠れる所にも入らない（名前 ${Math.round(n.top)}〜${Math.round(n.bottom)}・映像 ${Math.round(area.top)}〜${Math.round(area.bottom)}）`)
      const np = r[k].np
      const clearP = np.bottom <= area.top || (np.top >= area.top && np.bottom <= area.bottom)
      check(clearP && np.top >= 220 && np.bottom <= 1380 && np.bottom - np.top > n.bottom - n.top + 40, `${k}の動画：年齢と性別の行まで入れても、映像の端をまたがず隠れる所に入らない（${Math.round(np.top)}〜${Math.round(np.bottom)}）`)
    }
    check(r.tallP.bottom <= 1380 && r.tallP.top >= 220 && r.tallP.bottom - r.tallP.top > r.tall.bottom - r.tall.top + 40, `縦の動画：名前の下に年齢と性別が入る（${Math.round(r.tallP.top)}〜${Math.round(r.tallP.bottom)}）`)
    check(r.tallE.bottom - r.tallE.top === r.tall.bottom - r.tall.top, '年齢も性別も不明なら、名前の下の行は出さない')
    check(r.yellowProf > 200 && r.yellowBand.band === '#f5d547' && r.yellowBand.color !== '#ffffff' && r.yellowBand.contrast >= 4.5, `明るい黄色の帯は選んだ色のまま、年齢と性別まで濃い色の文字で描く（帯 ${r.yellowBand.band}・文字 ${r.yellowBand.color}・見やすさ ${Math.round(r.yellowBand.contrast * 10) / 10}）`)
    check(r.tall && r.tall.bottom <= 1380 && r.tall.top >= 220, '縦の動画の名前は、今までどおり下のほう（右下のボタンより上）')
  }
  await ctx.close()
}

// 表紙：名前の下にロゴか団体名（クローバー・左上のロゴなし）。猫カードにはロゴを入れない（11/6 作者の決定）。ひとこと・最後の1枚は便箋なし（11/6夜 作者の決定）
{
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  await p.goto(url)
  const r = await p.evaluate(async () => {
    try {
      const m = await import('/src/lib/card.ts')
      const cv = () => {
        const c = document.createElement('canvas')
        c.width = 1080
        c.height = 1920
        return c
      }
      const pic = (w, h, color) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const x = c.getContext('2d')
        x.fillStyle = color
        x.fillRect(0, 0, w, h)
        return c
      }
      // ロゴは見分けやすい色（赤紫）1色。カードの中にこの色があるかで、ロゴが描かれたかを見る
      const MAG = [255, 0, 255]
      const magenta = (c, y0 = 0, y1 = 1920) => {
        const d = c.getContext('2d').getImageData(0, y0, 1080, y1 - y0).data
        let n = 0
        let top = 1e9
        let bottom = -1
        for (let i = 0; i < d.length; i += 4)
          if (Math.abs(d[i] - MAG[0]) < 8 && d[i + 1] < 8 && Math.abs(d[i + 2] - MAG[2]) < 8) {
            n++
            const y = y0 + Math.floor(i / 4 / 1080)
            top = Math.min(top, y)
            bottom = Math.max(bottom, y)
          }
        return { n, top, bottom }
      }
      const tall = pic(600, 800, '#8fa9a3')
      const wide = pic(800, 600, '#8fa9a3')
      const square = pic(700, 700, '#8fa9a3')
      const round = pic(400, 400, 'rgb(255,0,255)')
      const long = pic(900, 300, 'rgb(255,0,255)')
      const out = {}
      for (const [k, photo] of [['縦', tall], ['横', wide], ['正方形', square]]) {
        for (const [lk, logo] of [['丸', round], ['横長', long], ['なし', null]]) {
          const c = cv()
          const l = m.drawCoverCard(c.getContext('2d'), { photo, logo, name: 'テスト', theme: '#e8826b', shelterName: '（架空）テスト保護猫の会' })
          const mg = magenta(c)
          out[`${k}・${lk}`] = { fits: l.fits, mark: l.mark, markBottom: l.markBottom, mg, leftTop: magenta(c, 220, 400).n && mg.top < 400 }
        }
      }
      // 名前の位置は、ロゴがあってもなくても同じ（ロゴのために上げない）：名前の上の端の高さを、ロゴあり・なしで比べる
      const nameTop = (logo) => {
        const c = cv()
        m.drawCoverCard(c.getContext('2d'), { photo: tall, logo, name: 'テスト', theme: '#e8826b', shelterName: '' })
        const d = c.getContext('2d').getImageData(540, 0, 1, 1920).data
        for (let y = 0; y < 1920; y++) if (d[y * 4] > 250 && d[y * 4 + 1] > 250 && d[y * 4 + 2] > 250) return y
        return -1
      }
      out.sameTop = nameTop(null) === nameTop(round)
      const cat = cv()
      m.drawCatCard(cat.getContext('2d'), { photo: tall, logo: round, name: 'テスト', lines: ['よく食べる'], theme: '#e8826b', position: 'normal' })
      const catB = cv()
      m.drawCatCard(catB.getContext('2d'), { photo: wide, logo: round, name: 'テスト', lines: ['よく食べる'], theme: '#e8826b', position: 'normal' })
      out.noLogo = [magenta(cat).n, magenta(catB).n]
      // ひとこと・最後の1枚（11/6夜 作者の決定）：便箋・切手・クローバーなし。縦の写真は写真の上に白い文字、横・正方形は上の帯に白い文字
      const ev = { date: '2026-11-15', startTime: '13:00', endTime: '16:00', venue: '（架空）会場' }
      const green = (c) => {
        const d = c.getContext('2d').getImageData(0, 0, 1080, 1920).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x5f) < 10 && Math.abs(d[i + 1] - 0x9e) < 10 && Math.abs(d[i + 2] - 0x5a) < 10) n++
        return n
      }
      out.cards = []
      for (const theme of ['#e8826b', '#5a9e6f', '#f5d547']) {
        for (const [pk, photo] of [['縦', tall], ['横', wide], ['正方形', square]]) {
          for (const [lk, logo] of [['丸', round], ['横長', long], ['なし', null]]) {
            for (const [ek, event] of [['譲渡会なし', null], ['譲渡会あり', ev]]) {
              const c = cv()
              const l = m.drawEndCard(c.getContext('2d'), { logo, shelterName: '（架空）テスト保護猫の会', contact: '（架空）Instagramのメッセージでどうぞ\n（架空）test@example.com', event, theme, photo })
              const mg = magenta(c)
              out.cards.push({ kind: '最後の1枚', theme, pk, lk, ek, fits: l.fits, design: l.design, top: l.textTop, bottom: l.textBottom, contrast: l.contrast, contact: l.contactPx, logo: mg.n, logoH: mg.bottom - mg.top, clover: green(c) })
            }
          }
          const c = cv()
          const l = m.drawWordsCard(c.getContext('2d'), { text: '（架空）甘えん坊です。\n抱っこも好き。\n夜は一緒に寝ています。', theme, photo })
          out.cards.push({ kind: 'ひとこと', theme, pk, lk: 'なし', ek: '', fits: l.fits, design: l.design, top: l.textTop, bottom: l.textBottom, contrast: l.contrast, lines: l.lines, sec: l.sec, logo: magenta(c).n, clover: green(c) })
        }
      }
      // 団体名の最後の1文字だけが次の行に落ちない（11/6夜 作者の決定）
      const x = cv().getContext('2d')
      out.orphan = []
      for (const px of [76, 54, 60]) {
        x.font = `800 ${px}px sans-serif`
        for (let n = 8; n <= 40; n++) {
          const name = '（架空）' + 'ひだまり保護猫のおうち探しの会'.repeat(3).slice(0, n)
          const lines = m.wrapName(x, name, 836)
          out.orphan.push({ px, n, ok: lines.join('') === name && (lines.length < 2 || [...lines[lines.length - 1]].length >= 2) })
        }
      }
      out.bands = ['#e8826b', '#5a9e6f', '#f5d547', '#ffffff', '#ffe4ec', '#fff44f', '#d4a72c', '#1e3a5f'].map((t) => m.bandColors(t))
      // ロゴ（11/7 作者の決定）：Instagramのアイコンと同じく、丸い枠で真ん中をそのまま切り取るだけ（白い余白は詰めない）。
      // 台を足さない。透明なロゴはテーマ色の丸の上
      const MAGENTA = 'rgb(255,0,255)'
      const logoOn = (bg, draw) => {
        const c = cv()
        c.width = 400
        c.height = 400
        const x = c.getContext('2d')
        if (bg) {
          x.fillStyle = bg
          x.fillRect(0, 0, 400, 400)
        }
        x.fillStyle = MAGENTA
        draw(x)
        return c
      }
      const L = {
        透明: logoOn(null, (x) => { x.beginPath(); x.arc(200, 200, 120, 0, Math.PI * 2); x.fill() }),
        白い背景: logoOn('#ffffff', (x) => { x.beginPath(); x.arc(200, 200, 120, 0, Math.PI * 2); x.fill() }),
        写真: pic(400, 400, MAGENTA),
        縦長: logoOn(null, (x) => { x.fillRect(0, 0, 400, 400) }),
      }
      L.縦長.width = 200
      L.縦長.height = 400
      L.縦長.getContext('2d').fillStyle = MAGENTA
      L.縦長.getContext('2d').fillRect(0, 0, 200, 400)
      const px = (c, x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3).join(',')
      const band = m.bandColors('#e8826b').band
      const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',')
      out.logo = { band: rgb(band), theme: rgb('#e8826b'), prep: {} }
      for (const [k, logo] of Object.entries(L)) {
        // 横の写真の最後の1枚（譲渡会なし）：丸いアイコンは上の帯の真ん中、x 440〜640・y 220〜420（直径200）
        const c = cv()
        m.drawEndCard(c.getContext('2d'), { logo, shelterName: '（架空）テスト保護猫の会', contact: '', event: null, theme: '#e8826b', photo: wide })
        out.logo.prep[k] = { corner: px(c, 441, 221), edge: px(c, 443, 320), center: px(c, 540, 320), top: px(c, 540, 223) }
      }
      return out
    } catch (e) {
      // 本番と同じ作りでは、部品を直接読めない（そのときだけ飛ばす。ほかのまちがいは確認NGにする）
      return String(e).includes('import') || String(e).includes('Failed to fetch') || String(e).includes('Importing') ? null : { error: String(e) }
    }
  })
  if (r?.error) check(false, `表紙・ひとこと・最後の1枚の確認が途中で止まった（${r.error}）`)
  if (r && !r.error) {
    for (const k of ['縦', '横', '正方形']) {
      for (const lk of ['丸', '横長']) {
        const t = r[`${k}・${lk}`]
        check(t.mark === 'logo' && t.fits && t.mg.n > 0 && t.mg.bottom <= 1620 && t.mg.top >= 220 && !t.leftTop, `表紙（${k}の写真・${lk}のロゴ）：ロゴは名前の下に入り、隠れる所・左上には出ない（ロゴ ${t.mg.top}〜${t.mg.bottom}）`)
      }
      const t = r[`${k}・なし`]
      check(t.mark === 'org' && t.fits && t.mg.n === 0, `表紙（${k}の写真・ロゴなし）：名前の下に団体名が入り、はみ出さない`)
    }
    check(r['縦・丸'].mg.bottom - r['縦・丸'].mg.top >= 210, `表紙のロゴは220pxくらいの大きさ（丸いロゴの高さ ${r['縦・丸'].mg.bottom - r['縦・丸'].mg.top + 1}px）`)
    check(r.sameTop, '表紙の言葉と名前は、ロゴがあってもなくても同じ位置（ロゴのために上げない）')
    check(r.noLogo.every((n) => n === 0), `猫カード（縦・横）には、ロゴを入れない（${r.noLogo.join('/')}）`)
    const bad = (f) => r.cards.filter(f).map((c) => `${c.kind}・${c.theme}・${c.pk}・${c.lk}・${c.ek}`)
    check(bad((c) => !c.fits).length === 0, `ひとこと・最後の1枚：3色×縦・横・正方形×ロゴ×譲渡会のすべてで入る（入らない：${bad((c) => !c.fits).join('、') || 'なし'}）`)
    check(bad((c) => c.clover > 0).length === 0, 'ひとこと・最後の1枚：クローバー（切手・消印）は描かない')
    check(bad((c) => c.contrast < 4.5).length === 0, `白い文字の見やすさは、すべて4.5以上（最小 ${Math.min(...r.cards.map((c) => c.contrast))}）`)
    check(bad((c) => c.design === 'A' && (c.top < 800 || c.bottom > 1620)).length === 0, `縦の写真：文字は顔にかからない高さ（800より下）から、下300の隠れる所より上（${bad((c) => c.design === 'A' && (c.top < 800 || c.bottom > 1620)).join('、') || 'すべてOK'}）`)
    check(bad((c) => c.design === 'B' && (c.top !== 220 || c.bottom > 1380)).length === 0, '横・正方形の写真：文字は上の帯（上220より下、右下のボタンの高さより上）')
    check(r.cards.filter((c) => c.pk === '縦').every((c) => c.design === 'A') && r.cards.filter((c) => c.pk !== '縦').every((c) => c.design === 'B'), '縦の写真は写真の上に文字、横・正方形の写真は帯')
    const ends = r.cards.filter((c) => c.kind === '最後の1枚')
    check(ends.filter((c) => c.lk !== 'なし').every((c) => c.logo > 0 && c.logoH >= 60) && ends.filter((c) => c.lk === 'なし').every((c) => c.logo === 0), '最後の1枚：ロゴがあれば大きめに入る（ロゴがなければ入らない）')
    check(ends.every((c) => c.contact >= 36), `最後の1枚：譲渡会ありでも、連絡先はスマホで読める大きさ（36px＝スマホで約13px以上。最小 ${Math.min(...ends.map((c) => c.contact))}px）`)
    check(r.cards.filter((c) => c.kind === 'ひとこと').every((c) => c.logo === 0 && c.lines === 3 && c.sec === 5), 'ひとこと：改行どおり3行、5秒（ロゴは入れない）')
    check(r.orphan.every((o) => o.ok), `団体名の最後の1文字だけが、次の行に落ちない（${r.orphan.filter((o) => !o.ok).map((o) => o.px + 'px・' + o.n + '字').join('、') || 'すべてOK'}）`)
    const lp = r.logo.prep
    check(Object.values(lp).every((q) => q.corner === r.logo.band), `ロゴは丸い枠で切り取り、丸の外（四角の角）には何も足さない（帯の色のまま。${Object.entries(lp).map(([k, q]) => k + ' ' + q.corner).join('・')}）`)
    check(lp['透明'].edge === r.logo.theme && lp['透明'].center === '255,0,255', `透明なロゴは、テーマ色の丸の上に出る（丸のふち ${lp['透明'].edge}・まん中 ${lp['透明'].center}）`)
    check(lp['白い背景'].edge === '255,255,255' && lp['白い背景'].center === '255,0,255', `白い背景のロゴは、白い余白を詰めずに、そのまま丸く切り取る（丸のふち ${lp['白い背景'].edge}）`)
    check(lp['写真'].edge === '255,0,255' && lp['写真'].top === '255,0,255', '余白のない画像（写真など）は、丸いっぱいに真ん中を切り取る')
    check(lp['縦長'].edge === '255,0,255' && lp['縦長'].top === '255,0,255', '縦長の画像も、丸いっぱいに真ん中を切り取る（すき間を作らない）')
    {
      const themes = ['#e8826b', '#5a9e6f', '#f5d547', '#ffffff', '#ffe4ec', '#fff44f', '#d4a72c', '#1e3a5f']
      check(r.bands.every((b, i) => b.band === themes[i]), `帯は選んだテーマ色のまま（11/8 作者の決定。${r.bands.map((b) => b.band).join('・')}）`)
      check(r.bands.every((b) => ['#ffffff', '#3b2f2a', '#000000'].includes(b.color) && b.contrast >= 4.5), `帯の文字は白か濃い色で、見やすさ4.5以上（${r.bands.map((b) => b.color + ' ' + Math.round(b.contrast * 10) / 10).join('・')}）`)
      check(r.bands[7].color === '#ffffff' && r.bands[3].color !== '#ffffff', `暗い帯（紺）は白い文字、明るい帯（白）は濃い文字（${r.bands[7].color}・${r.bands[3].color}）`)
    }
  }
  await ctx.close()
}

// シェルター情報のロゴの欄（11/7 作者の決定）：「Instagramのアイコンと同じ画像を入れると、きれいに出ます。丸く切り抜いて表示します」。
// 試し用では確認用の仮のロゴ（透明・透明で暗い色・白い背景）を入れられる。ロゴの見本にも、ホームの丸いアイコンにも、白い台を足さない
{
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  await p.goto(url + '/?sizes=1')
  await p.getByText('はじめに').waitFor()
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  check(await p.getByText('Instagramのアイコンと同じ画像を入れると、きれいに出ます。丸く切り抜いて表示します').isVisible(), 'ロゴの欄に「Instagramのアイコンと同じ画像を入れると、きれいに出ます。丸く切り抜いて表示します」と出る')
  const testMode = (await p.locator('[data-test-logos]').count()) === 1
  if (testMode) {
    await p.locator('[data-test-logos]').getByRole('button', { name: '透明', exact: true }).click()
    await p.locator('.logo-thumb').waitFor({ timeout: 5000 }).catch(() => {})
    const a = await p.locator('.logo-thumb').evaluate(async (img) => {
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const x = c.getContext('2d')
      x.drawImage(img, 0, 0)
      return [x.getImageData(0, 0, 1, 1).data[3], x.getImageData(200, 250, 1, 1).data[3]]
    })
    check(a[0] === 0 && a[1] === 255, `確認用の仮のロゴ（透明）を入れられる（角は透明・まん中は色。${a.join('/')}）`)
    check((await p.locator('[data-test-logos] button').count()) === 3, '確認用の仮のロゴは3種類（透明・透明で暗い色・白い背景）')
    const thumbBg = await p.locator('.logo-thumb').evaluate((el) => getComputedStyle(el).backgroundColor)
    check(thumbBg === 'rgba(0, 0, 0, 0)' || thumbBg === 'transparent', `ロゴの小さな見本に、白い台を敷かない（${thumbBg}）`)
    await p.screenshot({ path: join(outDir, '1c_シェルター_仮のロゴ.png'), fullPage: true })
    // ホームの上のロゴは、丸いアイコン（透明なロゴはテーマ色の丸の上。丸の外は透明で、白い台を足さない）
    await p.getByLabel('団体名').fill('（架空）テスト保護猫の会')
    await p.getByRole('button', { name: '登録して始める' }).click()
    await p.locator('.hero-logo').waitFor({ timeout: 5000 }).catch(() => {})
    const h = await p.locator('.hero-logo').evaluate(async (img) => {
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const x = c.getContext('2d')
      x.drawImage(img, 0, 0)
      const at = (u, v) => [...x.getImageData(Math.round(u * c.width), Math.round(v * c.height), 1, 1).data]
      const st = getComputedStyle(img)
      return { corner: at(0.02, 0.02)[3], edge: at(0.04, 0.5), bg: st.backgroundColor, radius: st.borderRadius }
    }).catch(() => null)
    check(h && h.corner === 0 && h.edge.slice(0, 3).join(',') === '232,130,107' && (h.bg === 'rgba(0, 0, 0, 0)' || h.bg === 'transparent'), `ホームの上のロゴは丸いアイコン（丸の外は透明・透明なロゴはテーマ色の丸の上・白い台なし。${JSON.stringify(h)}）`)
    await p.screenshot({ path: join(outDir, '1d_ホーム_丸いロゴ.png') })
  } else check(true, '本番と同じ作りでは、確認用の仮のロゴのボタンは出ない')
  await ctx.close()
}

// 画面のテーマ色（11/8 作者の決定）：ボタンは選んだテーマ色のまま。上の文字は白か濃い色の読みやすいほう（見やすさ4.5以上）。
// 地の色の上のテーマ色の文字（団体名）は、読めなければ画面の文字の色
for (const theme of ['#e8826b', '#f5d547', '#fff44f', '#1e3a5f']) {
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  await p.goto(url + '/?sizes=1')
  await p.getByText('はじめに').waitFor()
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p.getByLabel('団体名').fill('（架空）テスト保護猫の会')
  await p.locator('input[type=color]').fill(theme)
  await p.getByRole('button', { name: '登録して始める' }).click()
  await p.getByText('新しい子を紹介').waitFor()
  const r = await p.evaluate(() => {
    const rgb = (s) => (s.match(/[0-9.]+/g) ?? []).slice(0, 3).map(Number)
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10 }
    const bg = rgb(getComputedStyle(document.body).backgroundColor)
    const sub = document.querySelector('.hero-sub')
    const btn = document.querySelector('.btn-primary')
    return { sub: ratio(rgb(getComputedStyle(sub).color), bg), btn: btn ? ratio(rgb(getComputedStyle(btn).backgroundColor), rgb(getComputedStyle(btn).color)) : null, theme: getComputedStyle(document.querySelector('.app')).getPropertyValue('--theme').trim(), subRgb: rgb(getComputedStyle(sub).color), btnRgb: btn ? rgb(getComputedStyle(btn).backgroundColor) : null }
  })
  const want = [1, 3, 5].map((i) => parseInt(theme.slice(i, i + 2), 16)).join()
  check(r.btnRgb?.join() === want, `テーマ色 ${theme}：ボタンは選んだ色のまま（${r.btnRgb}）`)
  if (theme === '#1e3a5f') check(r.subRgb.join() === want, `テーマ色 ${theme}：地の色の上で読める色なら、団体名もテーマ色のまま（${r.subRgb}）`)
  else check(r.subRgb.join() === '59,47,42', `テーマ色 ${theme}：地の色の上で読めない色なら、団体名は画面の文字の色（${r.subRgb}）`)
  check(r.sub >= 4.5 && (r.btn === null || r.btn >= 4.5), `テーマ色 ${theme}：ホームの団体名とボタンの文字は見やすさ4.5以上（団体名 ${r.sub}・ボタン ${r.btn}）`)
  check(r.theme.toLowerCase() === theme, `テーマ色 ${theme}：入力されたテーマ色はそのまま（${r.theme}）`)
  await p.screenshot({ path: join(outDir, `1e_ホーム_テーマ色${theme.slice(1)}.png`) })
  await ctx.close()
}

// 帯の枠（SPEC 3.1）：public/band.png があれば白黒の画像にテーマ色を重ねて敷く。なければテーマ色の無地。柄の画像はまだ入れていないので、仮の縞（灰色）ですりかえて試す
for (const withPattern of [false, true]) {
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  await p.route('**/band.png', (route) =>
    withPattern
      ? route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#ffffff"/>' + Array.from({ length: 24 }, (_, i) => `<rect y="${i * 80}" width="1080" height="40" fill="#9a9a9a"/>`).join('') + '</svg>',
        })
      : route.fulfill({ status: 404, body: '' }),
  )
  await p.goto(url)
  const r = await p.evaluate(async () => {
    try {
      const m = await import('/src/lib/card.ts')
      const band = await import('/src/lib/band.ts')
      const pattern = await band.loadBandPattern()
      const c = document.createElement('canvas')
      c.width = 1080
      c.height = 1920
      const wide = document.createElement('canvas')
      wide.width = 800
      wide.height = 600
      const l = m.drawCatCard(c.getContext('2d'), { photo: wide, logo: null, name: 'テスト', lines: ['よく食べる'], theme: '#e8826b', position: 'normal', pattern })
      const x = c.getContext('2d')
      const at = (y) => [...x.getImageData(20, y, 1, 1).data.slice(0, 3)].join(',')
      return { pattern: !!pattern, fits: l.fits, a: at(1650), b: at(1690), contrast: l.contrast }
    } catch {
      return null // 本番と同じ作りでは、部品を直接読めない
    }
  })
  if (r) {
    if (withPattern) check(!r.pattern && r.a === r.b && r.fits, `帯の柄はやめた：帯の画像を置いても、敷かない（11/8 作者の決定。${r.a} と ${r.b}）`)
    else check(!r.pattern && r.a === r.b && r.fits, `帯の画像がないときは、テーマ色の無地（${r.a}）`)
  }
  await ctx.close()
}

// 作者の絵と帯の線（11/8 作者の決定。SPEC 3.1）：public/art/ の絵を読んで、決まった所に描く。帯には線を1本ずつ
{
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  await p.goto(url)
  const r = await p.evaluate(async () => {
    let m
    try {
      m = await import('/src/lib/card.ts')
    } catch {
      return null // 本番と同じ作りでは、部品を直接読めない
    }
    try {
      // 絵は public/art/ から読んで入れる（band.ts と同じ絵。開発用のサーバーでは、直したあとの card.ts が別の入れ物で読まれることがあるので、ここで直接入れる）
      const img = async (n) => {
        const res = await fetch('/art/' + n + '.png', { cache: 'no-cache' })
        if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null
        return await createImageBitmap(await res.blob())
      }
      const band = await import('/src/lib/band.ts')
      const houseName = band.HOUSE_ART.split('/').pop().replace('.png', '')
      m.setDecor({ clover: await img('clover'), house: await img(houseName), flower: await img('flower'), paw: await img('paw') })
      const mk = (w, h) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const x = c.getContext('2d')
        x.fillStyle = '#7f9c92'
        x.fillRect(0, 0, w, h)
        return c
      }
      const card = () => mk(1080, 1920)
      const wide = mk(1200, 800)
      const tall = mk(600, 800)
      const count = (c, x0, y0, w, h, f) => {
        const d = c.getContext('2d').getImageData(x0, y0, w, h).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++
        return n
      }
      const green = (r, g, b) => g > 90 && g > r + 40 && g > b + 20
      const orange = (r, g, b) => r > 200 && g > 90 && g < 170 && b < 60
      const black = (r, g, b) => r < 40 && g < 40 && b < 40
      const teal = (r, g, b) => r < 90 && g > 100 && b > 90 && g - r > 40
      const out = {}
      const cB = card()
      const lB = m.drawCoverCard(cB.getContext('2d'), { photo: wide, logo: null, name: 'ソラ', theme: '#e8826b', shelterName: '（架空）ねこの会' })
      const cA = card()
      const lA = m.drawCoverCard(cA.getContext('2d'), { photo: tall, logo: null, name: 'ソラ', theme: '#e8826b', shelterName: '（架空）ねこの会' })
      out.clover = { B: lB.clover && count(cB, 0, 220, 1080, 600, green) > 300, A: lA.clover && count(cA, 0, 800, 1080, 700, green) > 300 }
      const cat = card()
      m.drawCatCard(cat.getContext('2d'), { photo: wide, logo: null, name: 'ソラ', lines: ['よく食べる'], theme: '#e8826b', position: 'normal' })
      out.paw = count(cat, 64, 220, 140, 500, black) > 300
      out.pawHidden = count(cat, 0, 0, 1080, 220, black) + count(cat, 0, 0, 64, 1920, black)
      // 帯の線：左右の端（文字を置かない所）の列に、線の色が上下で16pxずつ
      const lc = m.bandLineColor('#e8826b')
      const [lr, lg, lb] = [1, 3, 5].map((i) => parseInt(lc.slice(i, i + 2), 16))
      const isLine = (r, g, b) => Math.abs(r - lr) < 3 && Math.abs(g - lg) < 3 && Math.abs(b - lb) < 3
      out.lines = { left: count(cat, 2, 0, 1, 1920, isLine), right: count(cat, 1077, 0, 1, 1920, isLine) }
      const catA = card()
      m.drawCatCard(catA.getContext('2d'), { photo: tall, logo: null, name: 'ソラ', lines: ['よく食べる'], theme: '#e8826b', position: 'normal' })
      out.noLineA = count(catA, 2, 0, 1, 1920, isLine)
      out.noPawA = count(catA, 64, 220, 140, 500, black)
      const w = card()
      m.drawWordsCard(w.getContext('2d'), { text: '毎日癒されています', theme: '#e8826b', photo: wide })
      out.flower = count(w, 0, 220, 1080, 400, orange) > 100
      out.flowerHidden = count(w, 0, 0, 1080, 220, orange)
      const e = card()
      m.drawEndCard(e.getContext('2d'), { logo: null, shelterName: '（架空）ねこの会', contact: '', event: null, theme: '#e8826b', photo: wide })
      out.house = count(e, 0, 220, 1080, 300, teal) > 300
      // 肉球は猫カードだけ（1枚に絵は1つ。11/8 作者の決定）：表紙・ひとこと・最後の1枚の上の帯の左端に黒い所がない
      out.pawElsewhere = [cB, w, e].map((c) => count(c, 64, 220, 140, 600, black))
      // 文字が多い最後の1枚（縦の写真・譲渡会・ロゴ・連絡先3行）：家を先に小さく・なくして、文字は小さくしない（見直しの中2）
      const logo = mk(300, 300)
      const ev = { date: '2026-11-23', startTime: '13:00', endTime: '16:00', venue: '（架空）ひだまり公民館 2階' }
      const e2 = card()
      const l2 = m.drawEndCard(e2.getContext('2d'), { logo, shelterName: '（架空）ねこの会', contact: 'InstagramのDMで\nお問い合わせください\n見学は土日', event: ev, theme: '#e8826b', photo: tall })
      out.busyEnd = { fits: l2.fits, scale: l2.scale }
      return out
    } catch (err) {
      return { error: String(err) }
    }
  })
  if (r && !r.error) {
    check(r.clover.B && r.clover.A, `表紙の名前の横にクローバー（横の写真 ${r.clover.B}・縦の写真 ${r.clover.A}）`)
    check(r.paw, '横・正方形の写真の猫カード：上の帯の左端に肉球')
    check(r.pawHidden === 0, `肉球はInstagramで隠れる所（上220・左64）に入らない（黒い点 ${r.pawHidden}）`)
    check(r.noPawA < 50, `縦の写真のカードには肉球を描かない（${r.noPawA}）`)
    check(r.lines.left === 32 && r.lines.right === 32, `横・正方形の写真：上と下の帯に16pxの線を1本ずつ、カードの幅いっぱい（左端 ${r.lines.left}px・右端 ${r.lines.right}px）`)
    check(r.noLineA === 0, `縦の写真のカードには線を描かない（${r.noLineA}）`)
    check(r.flower, 'ひとことカードに花')
    check(r.pawElsewhere.every((n) => n < 50), `肉球は猫カードだけ。表紙・ひとこと・最後の1枚には入れない（黒い点 ${r.pawElsewhere.join('・')}）`)
    check(r.flowerHidden === 0, `花は上の隠れる所（上220）に入らない（${r.flowerHidden}）`)
    check(r.busyEnd.fits && r.busyEnd.scale === 1, `文字が多い最後の1枚でも、家のせいで文字を小さくしない（入る ${r.busyEnd.fits}・大きさ ${r.busyEnd.scale}）`)
    check(r.house, '最後の1枚に家')
  } else if (r?.error) check(false, `作者の絵の確認が動かなかった（${r.error}）`)
  await ctx.close()
}

// 新しい版の知らせ（SPEC 2.9）：公開されている版（version.json）が、開いている画面の版と違うときだけ出す
{
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  let served = 'same' // same：開いている画面と同じ版 ／ new：新しい版 ／ none：読めない
  await p.route('**/version.json', async (route) => {
    if (served === 'none') return route.fulfill({ status: 404, body: '' })
    if (served === 'new') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'zzzzzzz' }) })
    return route.continue()
  })
  await p.goto(url)
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p.getByLabel('団体名').fill('テスト保護猫の会')
  await p.getByRole('button', { name: '登録して始める' }).click()
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  await p.getByRole('textbox', { name: /^名前/ }).fill('版の知らせの子')
  await p.waitForTimeout(2500)
  check(!(await p.locator('.update-bar').isVisible()), '開いている画面と同じ版なら、知らせは出ない')
  served = 'none'
  await p.evaluate(() => window.dispatchEvent(new Event('focus')))
  await p.waitForTimeout(800)
  check(!(await p.locator('.update-bar').isVisible()), '版が読めないとき（電波がないなど）は、知らせは出ない')
  served = 'new'
  // LINEなどから戻ってきたとき
  await p.evaluate(() => window.dispatchEvent(new Event('focus')))
  await p.locator('.update-bar').waitFor({ timeout: 3000 }).catch(() => {})
  check(await p.getByText('新しい版があります。').isVisible(), '新しい版が公開されていると、戻ってきたときに「新しい版があります。」と出る')
  check((await p.getByRole('textbox', { name: /^名前/ }).inputValue()) === '版の知らせの子', '知らせが出ても、勝手に読み込み直さない（入力はそのまま）')
  await p.screenshot({ path: join(outDir, '11_新しい版の知らせ.png') })
  served = 'same'
  await Promise.all([p.waitForEvent('load', { timeout: 8000 }).catch(() => {}), p.getByRole('button', { name: '読み込み直す' }).click()])
  await p.getByRole('textbox', { name: /^名前/ }).waitFor({ timeout: 8000 }).catch(() => {})
  check((await p.getByRole('textbox', { name: /^名前/ }).inputValue().catch(() => '')) === '版の知らせの子', '［読み込み直す］を押すと読み込み直し、入力の途中のまま開き直す')
  check(!(await p.locator('.update-bar').isVisible()), '読み込み直したあとは、知らせは出ない（同じ版になった）')
  check((await p.evaluate(() => window.__browserDialogs)) === 0, '知らせでブラウザの確認の窓は出ない')
  await ctx.close()
}

// 団体名が空のまま残っていたとき（前の版のデータなど）：シェルター情報を先に出し、入れるまで進ませない。途中は消さない（11/6 作者の決定・案1）
{
  const ctx = await browser.newContext({ ...phone })
  const p = await ctx.newPage()
  await p.goto(url)
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p.getByLabel('団体名').fill('テスト保護猫の会')
  await p.getByRole('button', { name: '登録して始める' }).click()
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  await p.getByRole('textbox', { name: /^名前/ }).fill('団体名の確かめの子')
  await p.waitForTimeout(1500)
  // 保存してある団体名を、空にする（前の版で空のまま残ったデータのまね）
  await p.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('hogoneko-card')
    r.onsuccess = () => {
      const db = r.result
      const tx = db.transaction('shelter', 'readwrite')
      const st = tx.objectStore('shelter')
      const g = st.get('main')
      g.onsuccess = () => st.put({ ...g.result, name: '  ' }, 'main')
      tx.oncomplete = () => { db.close(); res(1) }
      tx.onerror = () => rej(tx.error)
    }
    r.onerror = () => rej(r.error)
  }))
  await p.reload()
  await p.locator('[data-need-name="1"]').waitFor({ timeout: 5000 }).catch(() => {})
  check(await p.locator('[data-need-name="1"]').isVisible(), '団体名が空なら、開いたときにシェルター情報が出て「団体名が入っていません」と知らせる')
  check((await p.getByRole('button', { name: '戻る' }).count()) === 0, '団体名を入れるまで、戻るボタンは出ない（ほかの画面へ進めない）')
  await p.screenshot({ path: join(outDir, '12_団体名が空.png') })
  await p.getByRole('button', { name: '保存する' }).click()
  await p.getByText('団体名を入れてください').waitFor({ timeout: 2000 }).catch(() => {}) // ［保存する］は、入力を確定してから1拍おいて動く
  check(await p.getByText('団体名を入れてください').isVisible(), '空のまま［保存する］を押しても進まない')
  await p.getByLabel('団体名').fill('テスト保護猫の会')
  await p.getByRole('button', { name: '保存する' }).click()
  await p.getByRole('textbox', { name: /^名前/ }).waitFor({ timeout: 5000 }).catch(() => {})
  check((await p.getByRole('textbox', { name: /^名前/ }).inputValue().catch(() => '')) === '団体名の確かめの子', '団体名を入れて保存すると、入力の途中の画面へそのまま進む（途中は消えない）')
  await ctx.close()
}

await browser.close()
console.log(failures ? `確認NGが${failures}こあります` : 'すべて確認OK')
process.exit(failures ? 1 : 0)
