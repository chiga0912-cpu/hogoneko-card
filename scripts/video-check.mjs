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
await p.screenshot({ path: join(outDir, '6b_動画だけ_確認画面.png'), fullPage: true })
await p.getByRole('button', { name: '動画を作る' }).click()
await p.locator('.reel-video, .reel-images, .alert').first().waitFor({ timeout: 60000 })
const info = await p.evaluate(async () => { const v = document.querySelector('.reel-video'); if (!v) return document.querySelector('.reel-box').textContent; if (!v.duration) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true })); return { d: v.duration, m: v.dataset.method } })
ok(info && info.d >= 13.9 && info.d <= 14.1, '表紙2秒＋動画5秒＋猫カード3秒＋最後の1枚4秒＝14秒の動画ができる（' + JSON.stringify(info) + '・' + (await p.locator('.reel-box .muted').textContent().catch(() => '')) + '）')
await p.screenshot({ path: join(outDir, '6c_動画_保存の画面.png') })
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
await b.close()
console.log(failures ? `確認NG が ${failures} こ` : '動画の確認：全部OK')
process.exit(failures ? 1 : 0)
