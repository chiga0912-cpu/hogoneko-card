// 撮った動画（つまみ）と、動画を作る流れを確かめる（#7 #8）
// 使い方：npm run dev を動かした状態で node scripts/video-check.mjs <保存先フォルダ> [アドレス]
//   ENGINE=webkit で Safari と同じ仕組み、WIDTH=android で Androidの画面の大きさ
// 仮の動画（色のしまと数字が動くだけ。猫は映っていない）を、ffmpeg でその場で作る。リポジトリには入れない
import { chromium, webkit, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'screenshots'
const url = process.argv[3] ?? 'http://localhost:5173'
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'hogoneko-fake-'))
const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args])
ff(['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'tall12.mp4')])
ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=60:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'wide3.mp4')])
// 架空の位置（緯度0・経度0）を入れた動画（位置情報の確認のため）
ff(['-i', join(tmp, 'tall12.mp4'), '-c', 'copy', '-metadata', 'location=+00.0000+000.0000/', '-movflags', 'use_metadata_tags', join(tmp, 'tall12_loc.mov')])
// #45 の確認用：3分10秒の動画（小さい画面で軽く）と、200MBを超える仮のファイル（中身は意味のないバイト）
ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x284:rate=10:duration=190', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'long190.mp4')])
execFileSync('dd', ['if=/dev/zero', `of=${join(tmp, 'big.mp4')}`, 'bs=1000000', 'count=201'], { stdio: 'ignore' })
const FAKE = tmp

const eng = process.env.ENGINE === 'webkit' ? webkit : chromium
const iphone = devices['iPhone 15']
const pixel = devices['Pixel 7']
const phone = process.env.WIDTH === 'android' ? { ...iphone, viewport: pixel.viewport, screen: pixel.screen, deviceScaleFactor: pixel.deviceScaleFactor } : iphone
let failures = 0
const ok = (c, s) => {
  console.log((c ? '確認OK: ' : '確認NG: ') + s)
  if (!c) failures++
}
const b = await eng.launch()

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
  const _newContext = b.newContext.bind(b)
  b.newContext = async (o) => {
    const c = await _newContext(o)
    await c.addInitScript(AUTO_CONFIRM)
    c.on('page', (pg) => pg.on('dialog', () => pg.evaluate(() => (window.__browserDialogs += 1)).catch(() => {})))
    return c
  }
}
const ctx = await b.newContext({ ...phone })
const p = await ctx.newPage()
p.on('dialog', (d) => d.accept())
await p.goto(url + '/?sizes=1')
await p.getByText('はじめに').waitFor()
await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
await p.getByLabel('団体名').fill('テスト保護猫の会'); await p.getByRole('button', { name: '登録して始める' }).click()
await p.getByRole('button', { name: '新しい子を紹介' }).click()
await p.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'tall12.mp4'))
await p.locator('.clip-video').waitFor()
await p.getByLabel('使う5秒の始まり').waitFor({ timeout: 8000 })
await p.getByLabel('使う5秒の始まり').fill('4')
await p.waitForTimeout(800)
ok((await p.locator('.clip-time').textContent()).startsWith('0:04〜0:09'), 'つまみで始まりを4秒にすると、0:04〜0:09 を使う: ' + await p.locator('.clip-time').textContent())
const cur = await p.locator('.clip-video').evaluate(v => v.currentTime)
ok(cur >= 3.9 && cur <= 9.1, '選んだ5秒の中を再生している（今 ' + cur.toFixed(1) + '秒）')
await p.screenshot({ path: join(outDir, '6a_動画_つまみ.png'), fullPage: true })
await p.getByLabel('名前').fill('テスト')
await p.waitForTimeout(1000)
await p.reload()
await p.getByRole('button', { name: '入力の続き' }).click().catch(()=>{})
await p.locator('.clip-time').waitFor({ timeout: 5000 }).catch(()=>{})
ok((await p.locator('.clip-time').getAttribute('data-start').catch(()=>null)) === '4', '読み込み直しても、動画と始まり（4秒）が残る')
ok(await p.getByRole('button', { name: '次へ' }).isVisible(), '写真がなく動画だけでも先へ進める')
await p.getByRole('button', { name: '次へ' }).click()
await p.locator('.card-cover[data-drawn="1"]').waitFor()
await p.waitForTimeout(1500)
const dark = await p.locator('.card-cover').evaluate(c => { const d = c.getContext('2d').getImageData(540, 400, 1, 1).data; return d[0]+','+d[1]+','+d[2] })
ok(dark !== '107,95,85', '動画だけのとき、表紙に動画のコマが描かれる（色 ' + dark + '）')
await p.locator('.card-end[data-drawn="1"]').waitFor()
await p.waitForTimeout(800)
const endPx = await p.locator('.card-end').evaluate((c) => { const d = c.getContext('2d').getImageData(540, 500, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2] })
ok((await p.locator('.card-end').getAttribute('data-photo')) === 'clip' && endPx !== '107,95,85', '動画だけのとき、最後の1枚の上に動画のコマが描かれる（色 ' + endPx + '）')
await p.screenshot({ path: join(outDir, '6b_動画だけ_確認画面.png'), fullPage: true })
await p.getByRole('button', { name: '動画を作る' }).click()
await p.locator('.reel-video, .reel-images, .alert').first().waitFor({ timeout: 60000 })
const info = await p.evaluate(async () => { const v = document.querySelector('.reel-video'); if (!v) return document.querySelector('.reel-box').textContent; if (!v.duration) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true })); return { d: v.duration, m: v.dataset.method } })
ok(info && info.d >= 14.9 && info.d <= 15.1, '表紙3秒＋動画5秒＋猫カード3秒＋最後の1枚4秒＝15秒の動画ができる（' + JSON.stringify(info) + '・' + (await p.locator('.reel-box .muted').textContent().catch(() => '')) + '）')
await p.screenshot({ path: join(outDir, '6c_動画_保存の画面.png') })
ok((await p.getByTestId('location').textContent()).includes('なし'), 'できた動画の位置情報を確かめて「なし」と出る（確認モード）')
ok(await p.getByRole('button', { name: '投稿文をコピーしてInstagramへ' }).isEnabled(), '位置情報が「なし」なら、大きいボタンが押せる')
ok(await p.getByText('「リール」を選ぶ').isVisible(), '3つの手順の案内が出る')
// 大きいボタン：押すと投稿文がコピーされ、ボタンが「コピーしました ✓」に変わる。パソコンのテスト用ブラウザには
// 共有の画面がないことが多いので、そのときは「開けませんでした」と、動画を長押しして保存する案内が出る
if (process.env.ENGINE !== 'webkit') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
await p.evaluate(() => {
  window.__shared = null
  if (navigator.share) {
    navigator.share = async (d) => {
      window.__shared = d.files.map((f) => `${f.type}:${f.size}`)
    }
    navigator.canShare = () => true
  }
})
await p.getByRole('button', { name: '投稿文をコピーしてInstagramへ' }).click()
await p.getByRole('button', { name: 'コピーしました ✓' }).waitFor({ timeout: 5000 }).catch(() => {})
ok(await p.getByRole('button', { name: 'コピーしました ✓' }).isVisible(), '大きいボタンを押すと、ボタンが「コピーしました ✓」に変わる')
const shared = await p.evaluate(() => window.__shared)
if (shared) ok(shared.length === 1 && shared[0].startsWith('video/mp4:'), '共有の画面に、できた動画1本（mp4）を渡す')
else ok(await p.getByText('共有の画面を開けませんでした').isVisible(), '共有の画面がないときは、動画を長押しして保存する案内が出る')
await p.screenshot({ path: join(outDir, '6d_保存_コピーした.png'), fullPage: true })

// 名簿の子で動画を外したら、読み込み直しても戻らない
await p.getByRole('button', { name: '名簿を見る' }).click()
await p.getByText('テスト').first().click()
await p.locator('.clip-time').waitFor({ timeout: 5000 })
await p.getByRole('button', { name: '動画を外す' }).click()
await p.waitForTimeout(1200)
await p.reload()
await p.getByRole('button', { name: '入力の続き' }).click().catch(()=>{})
await p.getByLabel('名前').waitFor()
await p.waitForTimeout(800)
ok(!(await p.locator('.clip-time').isVisible()), '名簿の子で動画を外したら、読み込み直しても動画は戻らない')
// 短い横の動画
await p.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'wide3.mp4'))
await p.locator('.clip-time').waitFor()
await p.waitForTimeout(500)
ok((await p.getByText('5秒より短い動画なので、全部使います').isVisible()) && Number(await p.locator('.clip-time').getAttribute('data-length')) <= 3.01, '5秒より短い動画は全部使う（' + await p.locator('.clip-time').getAttribute('data-length') + '秒）')
// 架空の位置を入れた動画で：元の動画は「あり」、それを使って作った動画は「なし」
{
  const ctx2 = await b.newContext({ ...phone })
  const p2 = await ctx2.newPage()
  p2.on('dialog', (d) => d.accept())
  await p2.goto(url + '/?sizes=1')
  await p2.getByText('はじめに').waitFor()
  await p2.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p2.getByLabel('団体名').fill('テスト保護猫の会')
  await p2.getByRole('button', { name: '登録して始める' }).click()
  await p2.getByRole('button', { name: '新しい子を紹介' }).click()
  await p2.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'tall12_loc.mov'))
  await p2.locator('.clip-time').waitFor()
  const src = await p2.locator('.clip-video').evaluate(async (el) => {
    const b = await (await fetch(el.src)).blob()
    const v = await import('/src/lib/video.ts').catch(() => null)
    return v ? v.videoHasLocation(b) : '調べられない（本番と同じ作りでは部品を直接読めない）'
  })
  console.log('  元の動画（架空の位置入り）の位置情報：' + src)
  if (!url.includes('4173')) ok(src === 'あり', '架空の位置を入れた元の動画は「あり」と見つけられる')
  await p2.getByLabel('名前').fill('テスト')
  await p2.getByRole('button', { name: '次へ' }).click()
  await p2.getByRole('button', { name: '動画を作る' }).click()
  await p2.getByTestId('location').filter({ hasText: /なし|あり|調べられない/ }).waitFor({ timeout: 60000 })
  ok((await p2.getByTestId('location').textContent()).includes('なし'), '位置情報の入った動画を使っても、できた動画は「なし」')
  await ctx2.close()
}
// 動画を替えた直後にページが閉じたとき（11/5 見直しの重い1・2）。中身の書き込みを、わざと遅くして試す
{
  const ctx3 = await b.newContext({ ...phone })
  const p3 = await ctx3.newPage()
  p3.on('dialog', (d) => d.accept())
  // __slowAbove より大きいファイルの中身を読むのを4秒遅らせる（iPhoneで大きい動画を書くのに時間がかかる場面の代わり）
  await p3.addInitScript(() => {
    const orig = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = async function () {
      if (window.__slowAbove && this.size > window.__slowAbove) await new Promise((r) => setTimeout(r, 4000))
      return orig.call(this)
    }
  })
  const slow = (bytes) => p3.evaluate((b) => (window.__slowAbove = b), bytes)
  const reopen = async () => {
    await p3.reload()
    await p3.getByLabel('名前').waitFor()
    await p3.waitForTimeout(1200)
  }
  const shown = async () => ((await p3.locator('.clip-time').isVisible()) ? await p3.locator('.clip-time').getAttribute('data-length') : null)
  await p3.goto(url + '/?sizes=1')
  await p3.getByText('はじめに').waitFor()
  await p3.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p3.getByLabel('団体名').fill('テスト保護猫の会')
  await p3.getByRole('button', { name: '登録して始める' }).click()
  await p3.getByRole('button', { name: '新しい子を紹介' }).click()
  await p3.getByLabel('名前').fill('テスト')
  // #45：大きすぎる動画・長すぎる動画は、中身を写さずに知らせる
  await p3.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'big.mp4'))
  await p3.getByText('この動画は大きすぎるため選べません').waitFor({ timeout: 5000 }).catch(() => {})
  ok((await p3.getByText(/この動画は大きすぎるため選べません（\d+MB。200MBまで）。スマホの中で動画を作るときに、止まってしまうことがあるためです。写真アプリの［編集］で/).isVisible()) && !(await p3.locator('.clip-time').isVisible()), '200MBを超える動画は選べず、大きさ・理由・どうすればよいかを知らせる（#45）')
  await p3.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'long190.mp4'))
  await p3.getByText('この動画は長すぎるため選べません').waitFor({ timeout: 10000 }).catch(() => {})
  ok((await p3.getByText(/この動画は長すぎるため選べません（3:10。3分まで）。スマホの中で動画を作るときに、止まってしまうことがあるためです。写真アプリの［編集］で/).isVisible()) && !(await p3.locator('.clip-time').isVisible()), '3分を超える動画は選べず、長さ・理由・どうすればよいかを知らせる（#45）')
  await p3.screenshot({ path: join(outDir, '6e_動画が長すぎる.png'), fullPage: true })
  // (a) 短い動画を残したあと、長い動画に替え、その中身を書き終える前に読み込み直す
  await p3.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'wide3.mp4'))
  await p3.locator('.clip-time').waitFor()
  await p3.waitForTimeout(1500)
  await slow(3_000_000)
  await p3.getByRole('button', { name: '動画を外す' }).click()
  await p3.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'tall12.mp4'))
  await p3.locator('.clip-time').waitFor({ timeout: 15000 })
  await p3.waitForTimeout(800)
  await reopen()
  ok((await shown()) === null && (await p3.getByText('選んだ動画を残せていませんでした').isVisible()), '替えた動画を書き終える前に閉じても、前の動画に黙って戻らず、知らせる')
  // (b) 長い動画の書き込みが、あとで選んだ短い動画より遅く終わっても、短い動画が残る
  await slow(3_000_000)
  await p3.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'tall12.mp4'))
  await p3.locator('.clip-time').waitFor({ timeout: 15000 })
  await p3.getByRole('button', { name: '動画を外す' }).click()
  await p3.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'wide3.mp4'))
  await p3.locator('.clip-time').waitFor()
  await p3.waitForTimeout(6000) // 長い動画の遅い書き込みも終わるまで待つ
  await slow(0)
  await reopen()
  await p3.locator('.clip-video').evaluate((v) => (v.videoWidth ? 0 : new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true })))).catch(() => {})
  const dims = await p3.locator('.clip-video').evaluate((v) => [v.videoWidth, v.videoHeight]).catch(() => [0, 0])
  ok(Number(await shown()) <= 3.01 && dims[0] > dims[1], `あとで選んだ動画（横・3秒）が、その長さのまま残る（前の動画の中身と入れ違わない。${await shown()}秒・${dims.join('×')}）`)
  // 見直し③の重い3：動画を選んである途中を、何も変えずに開き直すだけで動画が外れない（大きな動画の書き直しが遅くても）
  await slow(1_000_000)
  await reopen()
  await p3.waitForTimeout(800)
  await reopen()
  await slow(0)
  ok((await shown()) !== null && !(await p3.getByText('選んだ動画を残せていませんでした').isVisible()), '動画のある途中を、何も変えずに続けて開き直しても、動画が外れない（見直し③の重い3）')
  // (c) 名簿の子を開いてメモを1行足し、すぐ閉じた（名簿の動画をまだ途中に書き終えていない）ときは、名簿の動画をそのまま使う
  //     （何も変えずに閉じたときは、入力の途中にならずホームに戻る。#42）
  await p3.getByRole('button', { name: '次へ' }).click()
  await p3.getByRole('button', { name: '動画を作る' }).click()
  await p3.getByText('名簿に保存しました').waitFor()
  await p3.getByRole('button', { name: '名簿を見る' }).click()
  await slow(1_000_000)
  await p3.getByText('テスト').first().click()
  await p3.locator('.clip-time').waitFor({ timeout: 15000 })
  await p3.getByLabel('預かりさんからのメッセージ・メモ').fill('（架空）追記')
  await p3.waitForTimeout(600)
  await slow(0)
  await reopen()
  ok(Number(await shown()) > 2.9 && !(await p3.getByText('選んだ動画を残せていませんでした').isVisible()), '名簿の子を開いてすぐ閉じたときは、名簿の動画をそのまま使う')
  await ctx3.close()
}
// 横の動画の帯：黒をやめ、テーマ色にする（柄の画像がないとき。SPEC 3.1。11/6 作者の決定）
{
  const ctx4 = await b.newContext({ ...phone })
  const p4 = await ctx4.newPage()
  p4.on('dialog', (d) => d.accept())
  await p4.goto(url + '/?sizes=1')
  await p4.getByText('はじめに').waitFor()
  await p4.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p4.getByLabel('団体名').fill('テスト保護猫の会')
  await p4.locator('input[type=color]').fill('#3f6f9a')
  await p4.getByRole('button', { name: '登録して始める' }).click()
  await p4.getByRole('button', { name: '新しい子を紹介' }).click()
  await p4.locator('input[type=file][accept="video/*"]').setInputFiles(join(FAKE, 'wide3.mp4'))
  await p4.locator('.clip-time').waitFor()
  await p4.getByLabel('名前').fill('テスト')
  await p4.getByRole('button', { name: '次へ' }).click()
  await p4.getByRole('button', { name: '動画を作る' }).click()
  await p4.locator('.reel-video').waitFor({ timeout: 90000 })
  // 表紙3秒のあとが撮った動画（3〜6秒）。4秒のところの、映像の上と下の帯の色を見る
  const px = await p4.locator('.reel-video').evaluate(async (v) => {
    if (!v.duration) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }))
    v.currentTime = 4
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }))
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const x = c.getContext('2d')
    x.drawImage(v, 0, 0)
    const at = (y) => [...x.getImageData(Math.round(c.width / 2), Math.round(y * c.height), 1, 1).data.slice(0, 3)]
    return { top: at(0.05), bottom: at(0.95) }
  })
  const near = (c) => Math.abs(c[0] - 0x3f) < 30 && Math.abs(c[1] - 0x6f) < 30 && Math.abs(c[2] - 0x9a) < 30
  ok(near(px.top) && near(px.bottom), `横の動画の帯は、黒ではなくテーマ色（上 ${px.top.join(',')}・下 ${px.bottom.join(',')}／テーマ色 63,111,154）`)
  await ctx4.close()
}
await b.close()
console.log(failures ? `確認NG が ${failures} こ` : '動画の確認：全部OK')
process.exit(failures ? 1 : 0)
