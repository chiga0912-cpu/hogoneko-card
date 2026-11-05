// 名簿の保存の形を版2にした（issue #3）ことの自動の確認。写真は本物の猫ではなく、色とまだら模様だけの仮の画像を使う
// - 古い形（版0・1）の名簿が読めて、写真の中身を変えずに版2へ移せるか
// - 移し替えの途中で失敗しても、名簿と写真が消えないか（失敗した子は古い形のまま残り、次に開いたときに移る）
// - 一覧は小さな表紙だけを読み、写真の置き場所に触らないか
// - カードには小さな表紙ではなく、元の写真を使っているか
// - 大きな写真が入った名簿を移す間も、画面が固まらないか
// 使い方：npm run dev を動かした状態で
//   node scripts/roster-check.mjs <保存先フォルダ> [アドレス]
//   ENGINE=webkit（Safariと同じ仕組み）、WIDTH=android（Androidの画面の大きさ）を付けられる
import { chromium, webkit, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'screenshots'
const url = process.argv[3] ?? 'http://localhost:5173'
const engine = process.env.ENGINE === 'webkit' ? webkit : chromium
mkdirSync(outDir, { recursive: true })
const iphone = devices['iPhone 15']
const pixel = devices['Pixel 7']
const phone =
  process.env.WIDTH === 'android'
    ? { ...iphone, viewport: pixel.viewport, screen: pixel.screen, deviceScaleFactor: pixel.deviceScaleFactor }
    : iphone
console.log(`名簿の確認：${process.env.ENGINE === 'webkit' ? 'WebKit' : 'Chromium'}・${phone.viewport.width}×${phone.viewport.height}`)

const COVER_MAX = 240 // src/lib/shrink.ts と同じ
const CARD_W = 1080 // src/lib/card.ts と同じ
let failures = 0
const check = (ok, what) => {
  console.log(ok ? `確認OK: ${what}` : `確認NG: ${what}`)
  if (!ok) failures++
}

// どのページにも先に入れる仕掛け（テストの側だけ。アプリには入れない）
// - 保存場所のどの置き場所を読んだかを残す
// - localStorage の印があるときだけ、決まった書き込み・読み込みをわざと失敗させる
// - 大きなカード（幅1080）に、どの大きさの画像を描いたかを残す
// - 画面が止まった一番長い時間を測る（10msごとに時計を見て、間があいた長さ）
const init = () => {
  const flag = (k) => {
    try {
      return localStorage.getItem(k) === '1'
    } catch {
      return false
    }
  }
  window.__reads = []
  for (const m of ['get', 'getAll', 'openCursor']) {
    const orig = IDBObjectStore.prototype[m]
    IDBObjectStore.prototype[m] = function (...a) {
      window.__reads.push(this.name)
      if (flag('__break_media_get') && this.name === 'catMedia') throw new DOMException('わざと失敗させた', 'UnknownError')
      return orig.apply(this, a)
    }
  }
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (v, ...rest) {
    if (flag('__break_media') && this.name === 'catMedia') throw new DOMException('わざと失敗させた', 'QuotaExceededError')
    if (flag('__break_cats_v2') && this.name === 'cats' && v && v.schemaVersion === 2)
      throw new DOMException('わざと失敗させた', 'QuotaExceededError')
    return put.call(this, v, ...rest)
  }
  window.__draws = []
  const di = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (src, ...a) {
    const w = src.naturalWidth || src.videoWidth || src.width
    const h = src.naturalHeight || src.videoHeight || src.height
    window.__draws.push({ cw: this.canvas.width, w, h })
    return di.call(this, src, ...a)
  }
  window.__maxGap = 0
  let last = performance.now()
  setInterval(() => {
    const n = performance.now()
    window.__maxGap = Math.max(window.__maxGap, n - last)
    last = n
  }, 10)
}

// 11/4〜11/5の形（保存場所の番号1、版0・1）の名簿を、アプリを開く前に作る。
// 写真はまだら模様の仮のJPEG（1匹ずつ色を変える）。中身の指紋（SHA-256）を返す
const seedV1 = (p, opts) =>
  p.evaluate(async ({ bigCats, perCat, w, h }) => {
    const hex = async (buf) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const noise = ctx.createImageData(w || 1, h || 1)
    for (let i = 0; i < noise.data.length; i += 4) {
      const v = 120 + Math.floor(Math.random() * 60)
      noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v
      noise.data[i + 3] = 255
    }
    const photo = async (n) => {
      ctx.putImageData(noise, 0, 0)
      ctx.fillStyle = `hsl(${(n * 47) % 360} 70% 50%)`
      ctx.fillRect(0, 0, w, h / 4)
      const b = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
      return { __blob: true, type: 'image/jpeg', data: await b.arrayBuffer() }
    }
    const small = async (n) => {
      const c = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')
      c.width = 800
      c.height = 600
      const x = c.getContext('2d')
      x.fillStyle = `hsl(${(n * 47) % 360} 70% 50%)`
      x.fillRect(0, 0, 800, 600)
      const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
      return { __blob: true, type: 'image/jpeg', data: await b.arrayBuffer() }
    }
    const cats = []
    let n = 0
    for (let i = 1; i <= bigCats; i++) {
      const photos = []
      for (let k = 0; k < perCat; k++) photos.push(w ? await photo(n++) : await small(n++))
      cats.push({ id: `big-${i}`, name: `おおきな子${i}`, updatedAt: 100 + i, schemaVersion: 1, photos, clip: null })
    }
    // 撮った動画（中身は仮のバイト列）を持つ子
    cats[0].clip = { blob: { __blob: true, type: 'video/mp4', data: new Uint8Array(300000).fill(7).buffer }, start: 1, length: 5 }
    // 版の番号がない、最初の形（版0）の子
    cats.push({ id: 'v0-1', name: '版0の子', updatedAt: 50, photos: [await small(n++)] })
    // 写真のない子
    cats.push({ id: 'nophoto', name: '写真のない子', updatedAt: 40, schemaVersion: 1, photos: [], clip: null })
    // 1枚目が読めない写真の子（読めない写真も捨てずに移す）
    const broken = { __blob: true, type: 'image/jpeg', data: new Uint8Array([1, 2, 3, 4, 5]).buffer }
    cats.push({ id: 'broken', name: '読めない写真の子', updatedAt: 30, schemaVersion: 1, photos: [broken, await small(n++)], clip: null })
    // 読めない子（id の形が違う）。触らずに残す
    const unreadable = { id: 12345, name: '読めない子', photos: [await small(n++)] }

    await new Promise((resolve, reject) => {
      const req = indexedDB.open('hogoneko-card', 1)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore('shelter')
        db.createObjectStore('cats', { keyPath: 'id' })
        db.createObjectStore('events', { keyPath: 'id' })
        db.createObjectStore('drafts')
      }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['shelter', 'cats'], 'readwrite')
        tx.objectStore('shelter').put({ name: 'テスト保護猫の会', themeColor: '#e8826b', logo: null, hashtags: [], venues: [], schemaVersion: 1 }, 'main')
        for (const c of [...cats, unreadable]) tx.objectStore('cats').put(c)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    const prints = {}
    let bytes = 0
    for (const c of cats) {
      prints[c.id] = { photos: await Promise.all(c.photos.map((s) => hex(s.data))), clip: c.clip ? c.clip.blob.data.byteLength : 0 }
      bytes += c.photos.reduce((a, s) => a + s.data.byteLength, 0)
    }
    return { prints, bytes, ids: cats.map((c) => c.id) }
  }, opts)

// 保存場所の中身を、アプリを通さずに直接読む（指紋と形だけ返す）
const dump = (p) =>
  p.evaluate(async () => {
    const hex = async (buf) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('hogoneko-card')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const all = (store) =>
      new Promise((res) => {
        if (!db.objectStoreNames.contains(store)) return res({ keys: [], values: [] })
        const tx = db.transaction(store)
        const k = tx.objectStore(store).getAllKeys()
        const v = tx.objectStore(store).getAll()
        tx.oncomplete = () => res({ keys: k.result, values: v.result })
      })
    const cats = await all('cats')
    const media = await all('catMedia')
    const out = { version: db.version, cats: {}, media: {} }
    for (const c of cats.values) {
      let cover = null
      if (c.cover) {
        const b = new Blob([c.cover.data], { type: c.cover.type })
        try {
          const bm = await createImageBitmap(b)
          cover = { w: bm.width, h: bm.height, bytes: b.size }
        } catch {
          cover = { w: 0, h: 0, bytes: b.size }
        }
      }
      out.cats[c.id] = {
        schemaVersion: c.schemaVersion,
        name: c.name,
        hasPhotos: 'photos' in c,
        hasClip: 'clip' in c,
        inlinePhotos: Array.isArray(c.photos) ? await Promise.all(c.photos.map((s) => hex(s.data))) : null,
        cover,
      }
    }
    media.keys.forEach((k, i) => (out.media[k] = media.values[i]))
    for (const k of Object.keys(out.media)) {
      const m = out.media[k]
      out.media[k] = {
        photos: Array.isArray(m.photos) ? await Promise.all(m.photos.map((s) => hex(s.data))) : m.photos,
        clip: m.clip ? m.clip.blob.data.byteLength : 0,
        clipStart: m.clip ? m.clip.start : null,
      }
    }
    db.close()
    return out
  })

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const shapeLine = (p) => p.getByTestId('roster-shape').innerText().catch(() => '')
const waitShape = async (p, re, ms = 120000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (re.test(await shapeLine(p))) return Date.now() - t0
    await p.waitForTimeout(100)
  }
  return -1
}
const flag = (p, k, on) => p.evaluate(([k, on]) => (on ? localStorage.setItem(k, '1') : localStorage.removeItem(k)), [k, on])
const newCtx = async () => {
  const ctx = await browser.newContext({ ...phone })
  await ctx.addInitScript(init)
  return ctx
}
const clearDraft = (p) =>
  p.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('hogoneko-card')
        r.onsuccess = () => {
          const tx = r.result.transaction('drafts', 'readwrite')
          tx.objectStore('drafts').clear()
          tx.oncomplete = () => {
            r.result.close()
            res()
          }
        }
      }),
  )
const blank = `${url}/favicon.svg` // アプリを開かずに、同じアドレスの中で保存場所を作るためのページ

const browser = await engine.launch()

// ---- 1. 大きな写真が入った古い形の名簿を開き、移し替える ----
{
  const ctx = await newCtx()
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(String(e)))
  p.on('dialog', (d) => d.accept())
  await p.goto(blank)
  const BIG = { bigCats: 6, perCat: 3, w: 4032, h: 3024 } // iPhoneの元の写真（1200万画素）と同じ大きさ。小さくする前に保存した名簿をまねる
  const seed = await seedV1(p, BIG)
  console.log(`  仮の名簿：${BIG.bigCats}匹×${BIG.perCat}枚（${BIG.w}×${BIG.h}）＋3匹。写真の合計 ${(seed.bytes / 1024 / 1024).toFixed(1)}MB`)

  const t0 = Date.now()
  await p.goto(`${url}/?sizes=1`)
  await p.getByRole('button', { name: '新しい子を紹介' }).waitFor({ timeout: 60000 })
  const homeMs = Date.now() - t0
  const firstLine = await shapeLine(p)
  console.log(`  ホームが出るまで：${homeMs}ms（パソコン）。${firstLine}`)
  check(/古い形[1-9]/.test(firstLine) || /古い形0匹/.test(firstLine), '確認モードで「名簿：新しい形○匹・古い形○匹」が出る')
  await p.screenshot({ path: join(outDir, '3a_移し替え中_ホーム.png') })

  // 移し替えの間に、名簿を開いたり戻ったりする。ボタンを押してから画面が変わるまでの時間を測る
  await p.evaluate(() => (window.__maxGap = 0))
  const taps = []
  for (let i = 0; i < 3; i++) {
    let s = Date.now()
    await p.getByRole('button', { name: /名簿から選ぶ/ }).click()
    await p.getByText('選ぶと、前の内容が入った状態で開きます。').waitFor()
    taps.push(Date.now() - s)
    s = Date.now()
    await p.getByRole('button', { name: '戻る' }).click()
    await p.getByRole('button', { name: '新しい子を紹介' }).waitFor()
    taps.push(Date.now() - s)
  }
  const migMs = await waitShape(p, /古い形0匹/)
  const maxGap = await p.evaluate(() => window.__maxGap)
  console.log(`  移し替えが終わるまで：${migMs}ms。画面が止まった一番長い時間：${Math.round(maxGap)}ms。ボタンを押してから画面が変わるまで：${taps.join('/')}ms（パソコン）`)
  check(migMs >= 0, '古い形の子が全員、版2の形に移る（確認モードで「古い形0匹」）')
  check(Math.max(...taps) < 1000, '移し替えの間も、ボタンを押すと1秒以内に画面が変わる')
  check(maxGap < 500, `移し替えの間に、画面が0.5秒以上止まらない（一番長くて${Math.round(maxGap)}ms）`)
  check(!(await shapeLine(p)).includes('移せなかった'), '移せなかった子がいない')

  const d = await dump(p)
  check(d.version === 2, '保存場所の番号が2になる')
  check(
    seed.ids.every((id) => d.cats[id]?.schemaVersion === 2 && !d.cats[id].hasPhotos && !d.cats[id].hasClip),
    '移した子の名簿の記録は版2で、写真と動画を持たない',
  )
  check(seed.ids.every((id) => same(d.media[id]?.photos, seed.prints[id].photos)), '移した写真は、どの子も枚数・順番・中身（指紋）が前と同じ')
  check(d.media['big-1']?.clip === seed.prints['big-1'].clip && d.media['big-1']?.clipStart === 1, '撮った動画も、中身と選んだ場所が前と同じ')
  check(same(d.media['broken']?.photos, seed.prints['broken'].photos), '読めない写真も捨てずに移す')
  check(d.cats['12345']?.name === '読めない子' && d.cats['12345'].inlinePhotos?.length === 1 && !d.media['12345'], '読めない子は触らずに、古い形のまま残す')
  const covers = seed.ids.filter((id) => id !== 'nophoto' && id !== 'broken').map((id) => d.cats[id].cover)
  check(covers.every((c) => c && Math.max(c.w, c.h) <= COVER_MAX), `一覧の表紙は長い辺${COVER_MAX}px以下（${covers.map((c) => c && `${c.w}×${c.h}`).join(' ')}）`)
  check(d.cats['nophoto'].cover === null && same(d.media['nophoto']?.photos, []), '写真のない子は、表紙なしで移る')
  check(await p.getByText('読めなかった子が1匹います').isVisible(), '読めない子がいることは、今までどおりホームで知らせる')
  await p.screenshot({ path: join(outDir, '3b_移し替え後_ホーム.png') })

  // 開き直す：一覧は表紙だけを読み、写真の置き場所には触らない
  const t1 = Date.now()
  await p.reload()
  await p.getByRole('button', { name: '新しい子を紹介' }).waitFor()
  const homeMs2 = Date.now() - t1
  console.log(`  移したあと、ホームが出るまで：${homeMs2}ms（移す前は${homeMs}ms）。${await shapeLine(p)}`)
  await p.getByRole('button', { name: /名簿から選ぶ/ }).click()
  await p.locator('.roster-main img').first().waitFor()
  await p.waitForTimeout(300)
  const imgs = await p.locator('.roster-main img').evaluateAll((els) => els.map((e) => [e.naturalWidth, e.naturalHeight]))
  check(imgs.length === seed.ids.length - 1, `一覧に、写真のある子の表紙が全員分出る（${imgs.length}匹）`)
  // 読めない写真の子（broken）の表紙は出ないので、それ以外の子の表紙が、画像として読めているか
  const shown = imgs.filter(([w]) => w > 0)
  console.log(`  一覧の表紙の大きさ：${imgs.map((x) => x.join('×')).join(' ')}`)
  // 手元の確認用サーバー（npm run dev）では、表紙が壊れて見える（見直し A15。本番と同じ作りでは出る）。
  // そのため、本番と同じ作り（npm run build のあと vite preview）で動かしたときだけ判定する
  if (url.includes(':5173')) console.log('  （表紙が画像として出ているかは、手元の確認用サーバーでは判定しない。A15。vite preview のアドレスで動かすと判定する）')
  else check(shown.length === imgs.length - 1 && shown.every(([w, h]) => Math.max(w, h) <= COVER_MAX), `一覧の表紙が画像として出ていて、小さな表紙（長い辺${COVER_MAX}px以下）を使っている（${shown.length}匹）`)
  check(!(await p.evaluate(() => window.__reads)).includes('catMedia'), 'ホームと一覧を出すまでに、写真の置き場所を読んでいない')
  await p.screenshot({ path: join(outDir, '3c_移し替え後_名簿.png'), fullPage: true })

  // 選ぶと元の写真が入る。カードには小さな表紙ではなく元の写真を使う
  await p.evaluate(() => (window.__draws = []))
  await p.locator('.roster-main', { hasText: 'おおきな子1' }).click()
  await p.locator('.photo img').nth(2).waitFor()
  const formImgs = await p.locator('.photo img').evaluateAll((els) => els.map((e) => [e.naturalWidth, e.naturalHeight]))
  check(formImgs.length === 3 && formImgs.every(([w, h]) => w === BIG.w && h === BIG.h), `名簿から選ぶと、元の大きさの写真が3枚入る（${formImgs.map((x) => x.join('×')).join(' ')}）`)
  await p.getByRole('button', { name: '次へ' }).click()
  await p.getByRole('button', { name: '動画を作る' }).waitFor()
  await p.waitForTimeout(1500)
  const draws = (await p.evaluate(() => window.__draws)).filter((x) => x.cw === CARD_W)
  check(draws.some((x) => x.w === BIG.w && x.h === BIG.h), 'カードに、元の大きさの写真を描いている')
  check(!draws.some((x) => Math.max(x.w, x.h) <= COVER_MAX), `カードに、小さな表紙（長い辺${COVER_MAX}px以下）を描いていない`)
  await p.screenshot({ path: join(outDir, '3d_元の写真でカード.png') })

  // 保存し直しても、写真と動画は前と同じ
  await p.getByRole('button', { name: '動画を作る' }).click()
  await p.waitForTimeout(1500)
  const d2 = await dump(p)
  check(same(d2.media['big-1']?.photos, seed.prints['big-1'].photos) && d2.media['big-1'].clip === seed.prints['big-1'].clip, '名簿から開いて保存し直しても、写真と動画の中身は前と同じ')
  check(d2.cats['big-1'].cover && Math.max(d2.cats['big-1'].cover.w, d2.cats['big-1'].cover.h) <= COVER_MAX, '保存し直した子にも、小さな表紙ができる')

  // 新しい子を保存する
  await p.goto(`${url}/?sizes=1`)
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="#5a8"/></svg>`
  await p.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'a.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
  await p.locator('.photo img').first().waitFor()
  await p.getByLabel('名前').fill('新しい子')
  await p.getByRole('button', { name: '次へ' }).click()
  await p.getByRole('button', { name: '動画を作る' }).click()
  await p.waitForTimeout(1500)
  const d3 = await dump(p)
  const newId = Object.keys(d3.cats).find((k) => d3.cats[k].name === '新しい子')
  check(newId && d3.cats[newId].schemaVersion === 2 && !d3.cats[newId].hasPhotos && d3.media[newId]?.photos.length === 1, '新しく保存した子は、版2の形（写真は別の置き場所）で残る')

  // 消すと、記録と写真の両方が消える
  await p.goto(`${url}/?sizes=1`)
  await p.getByRole('button', { name: /名簿から選ぶ/ }).click()
  await p.getByRole('button', { name: 'おおきな子2を名簿から消す' }).click()
  await p.waitForTimeout(500)
  const d4 = await dump(p)
  check(!d4.cats['big-2'] && !d4.media['big-2'], '名簿から消すと、記録と写真の両方が消える')
  check(!!d4.cats['big-3'] && !!d4.media['big-3'], 'ほかの子は消えない')
  check(errors.length === 0, `画面の途中で止まる失敗が起きない${errors.length ? `（${errors[0]}）` : ''}`)
  await ctx.close()
}

// ---- 2. 写真の置き場所への書き込みが失敗する（容量がいっぱいのときの代わり）----
// ---- 3. 1回の書き込みの後半（名簿の記録を書き直すところ）だけが失敗する ----
for (const [key, label] of [
  ['__break_media', '写真の置き場所への書き込みが失敗'],
  ['__break_cats_v2', '書き込みの後半（名簿の記録から写真を外すところ）だけが失敗'],
]) {
  const ctx = await newCtx()
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(blank)
  const seed = await seedV1(p, { bigCats: 3, perCat: 2, w: 0, h: 0 })
  await flag(p, key, true)
  await p.goto(`${url}/?sizes=1`)
  await p.getByRole('button', { name: '新しい子を紹介' }).waitFor()
  await waitShape(p, /移せなかった6匹/, 20000)
  const line = await shapeLine(p)
  check(/古い形6匹/.test(line) && /移せなかった6匹/.test(line), `${label}：確認モードに「古い形6匹・移せなかった6匹」と出る（${line}）`)
  check((await p.locator('.alert').count()) === 0, `${label}：スタッフさんには知らせを出さない（名簿はそのまま使える）`)
  const d = await dump(p)
  check(seed.ids.every((id) => d.cats[id]?.schemaVersion !== 2 && same(d.cats[id].inlinePhotos, seed.prints[id].photos)), `${label}：名簿の記録は古い形のまま、写真の中身も前と同じ`)
  check(Object.keys(d.media).length === 0, `${label}：写真の置き場所に、中途半端な写しが残らない`)
  await p.screenshot({ path: join(outDir, `3e_移し替え失敗_${key}.png`) })
  await p.getByRole('button', { name: /名簿から選ぶ/ }).click()
  check((await p.locator('.roster-main img').count()) === seed.ids.length - 1, `${label}：一覧には全員の表紙が出る`)
  await p.locator('.roster-main', { hasText: 'おおきな子1' }).click()
  await p.locator('.photo img').nth(1).waitFor({ timeout: 5000 }).catch(() => {})
  check((await p.locator('.photo img').count()) === 2, `${label}：選ぶと、写真が2枚とも入る`)
  await clearDraft(p) // 開き直したときに入力画面へ戻らないように
  // 直して開き直すと、移し替えが終わる
  await flag(p, key, false)
  await p.goto(`${url}/?sizes=1`)
  await p.getByRole('button', { name: '新しい子を紹介' }).waitFor()
  check((await waitShape(p, /古い形0匹/, 20000)) >= 0, `${label}：失敗が直ってから開き直すと、移し替えが終わる`)
  const d2 = await dump(p)
  check(seed.ids.every((id) => same(d2.media[id]?.photos, seed.prints[id].photos)), `${label}：移したあとの写真の中身も前と同じ`)

  if (key === '__break_cats_v2') {
    // ---- 4. 名簿から選んだ子の写真が読めない ----
    await flag(p, '__break_media_get', true)
    await p.goto(`${url}/?sizes=1`)
    await p.getByRole('button', { name: /名簿から選ぶ/ }).click()
    await p.locator('.roster-main', { hasText: 'おおきな子2' }).click()
    const alert = p.getByText('写真を読み込めませんでした。名簿は消していません。もう一度押してください。')
    await alert.waitFor({ timeout: 5000 }).catch(() => {})
    check(await alert.isVisible(), '選んだ子の写真が読めないと「写真を読み込めませんでした。名簿は消していません。もう一度押してください。」と出る')
    check(!(await p.getByLabel('名前').isVisible().catch(() => false)), '写真が読めないときは、入力画面を開かない（写真のないまま保存させない）')
    await p.screenshot({ path: join(outDir, '3f_写真が読めない.png') })
    await flag(p, '__break_media_get', false)
    await p.locator('.roster-main', { hasText: 'おおきな子2' }).click()
    await p.locator('.photo img').nth(1).waitFor({ timeout: 5000 }).catch(() => {})
    check((await p.locator('.photo img').count()) === 2, 'もう一度押すと、写真が2枚とも入って開く')
    const d3 = await dump(p)
    check(same(d3.media['big-2']?.photos, seed.prints['big-2'].photos), '写真が読めなかったあとも、保存場所の写真は前と同じ')
  }
  await ctx.close()
}

// ---- 5. 古い版のタブを開いたまま、新しい版を開く ----
{
  const ctx = await newCtx()
  const a = await ctx.newPage()
  await a.goto(blank)
  await seedV1(a, { bigCats: 1, perCat: 1, w: 0, h: 0 })
  // 古い版のタブのかわり：番号1で開いたまま、閉じない
  await a.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('hogoneko-card', 1)
        r.onsuccess = () => {
          window.__held = r.result
          res()
        }
      }),
  )
  const b = await ctx.newPage()
  await b.goto(`${url}/?sizes=1`)
  const msg = b.getByText('ほかに開いているタブを閉じてください。名簿は消していません。')
  await msg.waitFor({ timeout: 5000 }).catch(() => {})
  check(await msg.isVisible(), '古い版のタブが開いていると「ほかに開いているタブを閉じてください。名簿は消していません。」と出る')
  await b.screenshot({ path: join(outDir, '3g_ほかのタブ.png') })
  await a.evaluate(() => window.__held.close())
  await b.getByRole('button', { name: '新しい子を紹介' }).waitFor({ timeout: 5000 }).catch(() => {})
  check(await b.getByRole('button', { name: '新しい子を紹介' }).isVisible(), 'そのタブが閉じられると、開き直さなくても続きが動いてホームが出る')
  check((await waitShape(b, /古い形0匹/, 20000)) >= 0, 'そのあと、移し替えも終わる')
  await ctx.close()
}

// ---- 6. 古い版に戻して保存し直したあと、また新しい版で開く（見直しで見つかった道）----
// catMedia にはもう3枚あり、名簿の記録は古い形（1枚）。どちらも消さずに残す
{
  const ctx = await newCtx()
  const p = await ctx.newPage()
  await p.goto(blank)
  const seed = await seedV1(p, { bigCats: 1, perCat: 3, w: 0, h: 0 })
  // 番号2の保存場所を作り、big-1 の写真3枚を catMedia に入れ、名簿の記録は1枚だけの古い形にする
  const before = await p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('hogoneko-card', 2)
        r.onupgradeneeded = () => r.result.createObjectStore('catMedia')
        r.onsuccess = () => {
          const db = r.result
          const tx = db.transaction(['cats', 'catMedia'], 'readwrite')
          const g = tx.objectStore('cats').get('big-1')
          g.onsuccess = () => {
            const c = g.result
            tx.objectStore('catMedia').put({ schemaVersion: 2, photos: c.photos, clip: c.clip }, 'big-1')
            tx.objectStore('cats').put({ ...c, photos: [c.photos[0]], clip: null })
          }
          tx.oncomplete = () => {
            db.close()
            resolve(true)
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  await p.goto(`${url}/?sizes=1`)
  await p.getByRole('button', { name: '新しい子を紹介' }).waitFor()
  await waitShape(p, /移せなかった1匹/, 20000)
  const d = await dump(p)
  check(before && same(d.media['big-1']?.photos, seed.prints['big-1'].photos), '古い版で保存し直された子：別の置き場所の写真3枚を上書きしない')
  check(same(d.cats['big-1']?.inlinePhotos, [seed.prints['big-1'].photos[0]]) && d.cats['big-1'].schemaVersion === 1, '古い版で保存し直された子：名簿の記録も古い形のまま残す')
  check(/移せなかった1匹/.test(await shapeLine(p)), '古い版で保存し直された子は、確認モードで「移せなかった1匹」に数える')
  // 選んでも開かない（開いて保存すると、片方の写真を上書きするため）
  await p.getByRole('button', { name: /名簿から選ぶ/ }).click()
  await p.locator('.roster-main', { hasText: 'おおきな子1' }).click()
  await p.getByText('写真を読み込めませんでした。名簿は消していません。').waitFor({ timeout: 5000 }).catch(() => {})
  check(await p.getByText('写真を読み込めませんでした。名簿は消していません。').isVisible(), '古い版で保存し直された子を選ぶと、開かずに「写真を読み込めませんでした」と出る')
  check(!(await p.getByLabel('名前').isVisible().catch(() => false)), '古い版で保存し直された子は、入力画面を開かない')
  const d2 = await dump(p)
  check(same(d2.media['big-1']?.photos, seed.prints['big-1'].photos) && same(d2.cats['big-1']?.inlinePhotos, [seed.prints['big-1'].photos[0]]), '古い版で保存し直された子を選んだあとも、2か所の写真は前と同じ')
  await ctx.close()
}

// ---- 7. 名簿の子を直している途中に、ページが読み込み直される（LINEに移ったときなど）----
{
  const ctx = await newCtx()
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(blank)
  const seed = await seedV1(p, { bigCats: 3, perCat: 2, w: 0, h: 0 }) // big-1 は動画あり
  await p.goto(`${url}/?sizes=1`)
  await p.getByRole('button', { name: '新しい子を紹介' }).waitFor()
  await waitShape(p, /古い形0匹/, 20000)
  const dropDraftPhotos = () =>
    p.evaluate(
      () =>
        new Promise((res) => {
          const r = indexedDB.open('hogoneko-card')
          r.onsuccess = () => {
            const tx = r.result.transaction('drafts', 'readwrite')
            tx.objectStore('drafts').delete('photos')
            tx.oncomplete = () => {
              r.result.close()
              res()
            }
          }
        }),
    )
  const pick = async (name) => {
    await p.goto(`${url}/?sizes=1`)
    await p.getByRole('button', { name: /名簿から選ぶ/ }).click()
    await p.locator('.roster-main', { hasText: name }).click()
    await p.locator('.photo img').nth(1).waitFor()
    await p.waitForTimeout(1000) // 入力の途中が書かれるのを待つ
  }
  // 動画のある子：読み込み直してから保存しても、動画が残る
  await pick('おおきな子1')
  await p.reload()
  await p.locator('.photo img').nth(1).waitFor({ timeout: 5000 }).catch(() => {})
  check((await p.locator('.photo img').count()) === 2, '名簿の子の途中で読み込み直すと、写真が2枚とも入った入力画面に戻る')
  await p.getByRole('button', { name: '次へ' }).click()
  await p.getByRole('button', { name: '動画を作る' }).click()
  await p.waitForTimeout(1500)
  let d = await dump(p)
  check(d.media['big-1']?.clip === seed.prints['big-1'].clip && same(d.media['big-1'].photos, seed.prints['big-1'].photos), '読み込み直したあとに保存しても、名簿の動画と写真は消えない')
  // 途中の写真が書かれる前にページが終わった：名簿の写真を使う
  await pick('おおきな子2')
  await dropDraftPhotos()
  await p.reload()
  await p.locator('.photo img').nth(1).waitFor({ timeout: 5000 }).catch(() => {})
  check((await p.locator('.photo img').count()) === 2, '途中の写真が書かれていなくても、名簿の子は名簿の写真で開き直す')
  // 途中の写真はあるが、名簿の写真・動画が読めない：開かずにホームで知らせる（動画なしで開いて保存させない）
  await clearDraft(p)
  await pick('おおきな子1')
  await flag(p, '__break_media_get', true)
  await p.reload()
  const note1 = p.getByText('入力の途中の内容が読めなかったので、ホームから始めます。')
  await note1.waitFor({ timeout: 5000 }).catch(() => {})
  check(await note1.isVisible(), '途中の写真はあっても、名簿の写真・動画が読めないときは、開かずにホームで知らせる')
  await flag(p, '__break_media_get', false)
  check((await dump(p)).media['big-1']?.clip === seed.prints['big-1'].clip, 'そのときも、名簿の動画は前と同じ')
  // そのうえ途中の写真もない：開かずにホームで知らせる
  await clearDraft(p)
  await pick('おおきな子3')
  await dropDraftPhotos()
  await flag(p, '__break_media_get', true)
  await p.reload()
  const note = p.getByText('入力の途中の内容が読めなかったので、ホームから始めます。')
  await note.waitFor({ timeout: 5000 }).catch(() => {})
  check(await note.isVisible(), '途中の写真も名簿の写真も読めないときは、写真なしで開かずに、ホームで知らせる')
  await flag(p, '__break_media_get', false)
  d = await dump(p)
  check(same(d.media['big-3']?.photos, seed.prints['big-3'].photos), 'そのときも、名簿の写真は前と同じ')
  await ctx.close()
}

await browser.close()
console.log(failures ? `確認NGが${failures}こあります` : 'すべて確認OK')
process.exit(failures ? 1 : 0)
