// 投稿文の物語の本文（#16）を確かめる。Claudeは呼ばない（窓口の答えを仮のものにすりかえる。費用はかからない）
// 使い方：npm run dev を動かした状態で node scripts/story-check.mjs [保存先フォルダ] [アドレス]
// メモ・写真はすべて架空・仮のもの
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { splitMemo, factChunks, stripHashtags, leakedWords, EXAMPLES, stripClosing, closingLine, CLOSINGS, tidyEmoji, dropMeta, removeSentence, parseVerdicts, flagOldName, writtenNameOf, OLD_NAME_REASON } from '../src/lib/story.ts'

const outDir = process.argv[2] ?? 'screenshots'
const url = process.argv[3] ?? 'http://localhost:5173'
mkdirSync(outDir, { recursive: true })
let failures = 0
const ok = (c, s) => {
  console.log((c ? '確認OK: ' : '確認NG: ') + s)
  if (!c) failures++
}

// ── プログラムの部分 ──
const chunks = splitMemo('（架空）ミントの近況です！ごはんをよく食べます。\n\nトイレも上手です\nただ夜はちょっと鳴きます。「かわいい」と言われます。')
ok(
  JSON.stringify(chunks) === JSON.stringify(['（架空）ミントの近況です！', 'ごはんをよく食べます。', 'トイレも上手です', 'ただ夜はちょっと鳴きます。', '「かわいい」と言われます。']),
  `メモを1行・1文ごとに区切る（${JSON.stringify(chunks)}）`,
)
ok(JSON.stringify(factChunks({ name: 'ミント', goodPoints: ['よく食べる', ' ', 'トイレが上手'] })) === JSON.stringify(['名前：ミント', 'いいところ：よく食べる', 'いいところ：トイレが上手']), '確認した項目を1つずつ区切る（空の行は入れない）')
ok(stripHashtags('よく食べます #保護猫 ＃里親募集\n毎日元気です') === 'よく食べます\n毎日元気です', '本文から「#」「＃」の言葉を外す')

ok(JSON.stringify(leakedWords('（架空）朝になると枕元でふみふみします', '（架空）チャイはよく寝ます')) === JSON.stringify(['枕元', 'ふみふみ']), 'お手本にだけある言葉が本文に出たら見つける')
ok(leakedWords('（架空）兄弟とよく遊びます', '（架空）兄弟とよく遊んでる').length === 0, 'メモにある言葉なら、お手本と同じでも問題にしない')
ok(EXAMPLES.length === 3 && EXAMPLES.every((e) => !/ワクチン/.test(e.body)), 'お手本は3本で、本文に健康のことを書いていない')

ok(stripClosing('（架空）よく食べます。\nそんなミントの、ずっとのおうちを探しています。') === '（架空）よく食べます。' && stripClosing('（架空）よく食べます！\nミントに、素敵なご縁がありますように🍀') === '（架空）よく食べます！', 'Claudeが書いたまとめの文は外す（決まった文と2回出ないように）')
ok(stripClosing('そんなに食べない子です。') === 'そんなに食べない子です。', '1行だけの本文や、まとめでない「そんな」の文は外さない')
ok(CLOSINGS.map((f) => f('ミント')).includes(closingLine(' ミント ', 'id-1')) && closingLine('ミント', 'id-1') === closingLine('ミント', 'id-1'), '決まった文は4つのどれかで、名前だけが入り、同じ猫なら同じ文')
{
  const V = (n) => Array.from({ length: n }, (_, i) => ({ i, ok: true, cites: [{ doc: 0, start: 0, end: 1, text: 'x' }], reason: '' }))
  const S2 = ['ミントはよく食べます。', '夜はよく眠ります。']
  const f1 = flagOldName(S2, V(2), 'ミント', 'ミルク')
  ok(!f1[0].ok && f1[0].reason === OLD_NAME_REASON && f1[1].ok, '名前を変えたあと、本文に前の名前が残っている文だけ、確認役の答えにかかわらず印を付ける（理由「前の名前が残っています」）')
  ok(flagOldName(S2, V(2), 'ミント', 'ミント').every((v) => v.ok), '名前を変えていなければ、印を付けない')
  ok(flagOldName(['モカちゃんはよく食べます。'], V(1), 'モカ', 'モカちゃん')[0].ok && !flagOldName(['モカはよく食べます。'], V(1), 'モカ', 'モカちゃん')[0].ok, '今の名前の中に前の名前が入っているとき（モカ→モカちゃん）は、今の名前の部分を除いて探す')
  ok(writtenNameOf({ body: '', parts: [], memoChunks: [], factChunks: ['名前：ミント'], writtenName: 'モカ' }) === 'モカ' && writtenNameOf({ body: '', parts: [], memoChunks: [], factChunks: ['名前：ミント'] }) === 'ミント', '本文を書いたときの名前（前の版の途中には無いので、確認した項目の名前で代わりにする）')
}
ok(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => closingLine('ミント', 'cat-' + k))).size >= 3, '猫が違えば、決まった文もばらける（全部が同じ文にならない）')

ok(tidyEmoji('（架空）よく食べます😊\nよく寝ます😊🍀\n遊びます🏠🐾', 3) === '（架空）よく食べます😊\nよく寝ます\n遊びます🐾', '同じ絵文字の2回目と、決まった文の🍀🏠を本文から外す')
ok(tidyEmoji('（架空）よく食べます😊\nよく寝ます🐾✨\n遊びます！💦') === '（架空）よく食べます😊\nよく寝ます\n遊びます！', 'Claudeが書いた本文の絵文字は1つまで。2つ目からは後ろを外す（11/7。投稿文全体で2つまでのため）')
ok(tidyEmoji('（架空）よく食べます😊😊🐾🐾✨💦', 2) === '（架空）よく食べます😊🐾', '同じ絵文字は数えず、ちがう絵文字を決めた数まで')
ok(tidyEmoji('（架空）よく食べます☺️🐾✨💦') === '（架空）よく食べます☺️', '異体字の印（FE0F）つきも1つと数える')
ok(CLOSINGS.map((f) => f('ミント')).includes('ミントに、温かいおうちが見つかりますように🏠'), '決まった文の「温かいおうち」は🏠')
ok(dropMeta('自然につなげて書きます。\n\n（架空）よく食べます！🐾\n\n(メモの内容を元にしています。)\n\n（架空）よく食べます！') === '（架空）よく食べます！🐾', '本文ではない前置き・注記と、同じ文の2回目を外す')

// 見直し（11/6）で見つかった場面
const P = '【ミント】\n（架空）トイレも上手です。夜はよく眠ります。\n夜は\n\n＜ひとこと＞\n「トイレも上手です。夜はよく鳴きます。」'
const R = removeSentence(P, '（架空）トイレも上手です。')
ok(R.includes('「トイレも上手です。夜はよく鳴きます。」') && !R.includes('（架空）トイレも上手です。'), '［消す］は本文の文だけを消し、ひとことは書き換えない（見直しの重い2）')
ok(removeSentence('【ミント】\n夜はよく眠ります。\n', '夜は') === '【ミント】\n夜はよく眠ります。\n', '［消す］は、その文を含む別の文を削らない（見直しの重い2）')
const cite = { type: 'content_block_location', document_index: 0, start_block_index: 0, end_block_index: 1, cited_text: 'x' }
ok(parseVerdicts([{ text: '1: ない（資料にない言葉：大好き）\nまとめ 1: ある', citations: [cite] }], 1)[0].ok === false, '一度「ない」と答えた文は、あとの「ある」で変えない（見直しの重い5）')
ok(parseVerdicts([{ text: '1: あるとは言えません', citations: [cite] }], 1)[0].ok === false, '「あるとは言えません」を「ある」と読まない（見直しの重い5）')
ok(parseVerdicts([{ text: '1: ある「なでると喉を鳴らします」', citations: [cite] }], 1)[0].ok === true && parseVerdicts([{ text: '1: ある — 根拠あり', citations: [cite] }], 1)[0].ok === true, '「ある「…」」「ある —」は「ある」と読む（モデル比較で、厳しすぎて読み落としていたのを直した）')
ok(parseVerdicts([{ text: '1: ある（資料にない言葉：とっても）', citations: [cite] }], 1)[0].ok === false, '「資料にない言葉」が書いてある答えは「ない」（見直しの重い5）')
ok(dropMeta('（架空）メモ帳をかじります。\n（ちょっと怖がりです）') === '（架空）メモ帳をかじります。\n（ちょっと怖がりです）' && stripClosing('（架空）よく遊びます。\n兄弟のおうちが見つかり、今はひとりです。') === '（架空）よく遊びます。\n兄弟のおうちが見つかり、今はひとりです。', '本当の文は、本文ではない行・まとめの文とまちがえて外さない（見直しの軽い11）')

// ── 画面の部分（窓口の答えをすりかえる）──
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 15'] })
await ctx.addInitScript(() => {
  // ツールの中の確認の知らせに［はい］で答える
  // window.__confirmAnswer が 'no' なら［やめる］。聞かれた文は window.__asked に残す
  new MutationObserver(() => {
    const d = document.querySelector('[data-confirm-dialog]')
    if (d && !d.dataset.answered) {
      d.dataset.answered = '1'
      window.__asked = d.textContent
      setTimeout(() => d.querySelector(window.__confirmAnswer === 'no' ? '[data-confirm="no"]' : '[data-confirm="yes"]')?.click(), 50)
    }
  }).observe(document, { childList: true, subtree: true })
})
const p = await ctx.newPage()
// 投稿文全体の絵文字（11/7 作者の決定）：決まった文も含めて2つまで。決まった文の絵文字は消さず、本文の後ろから消す
{
  await p.goto(url)
  const r = await p.evaluate(async () => {
    let post
    try {
      post = await import('/src/lib/post.ts')
    } catch {
      return null // 本番と同じ作りでは、部品を直接読めない（そのときだけ飛ばす）
    }
    const story = await import('/src/lib/story.ts')
    const types = await import('/src/types.ts')
    const E = /\p{Extended_Pictographic}\uFE0F?/gu
    const out = {}
    // 決まった文の4つ（絵文字あり3つ・なし1つ）を全部試す
    for (let k = 0; k < 400 && Object.keys(out).length < 4; k++) {
      const cat = { ...types.newCat(), id: 'cat-' + k, name: 'ミント' }
      const closing = story.closingLine(cat.name, cat.id)
      if (out[closing]) continue
      const text = post.makeFixedPost(cat, types.emptyShelter(), new Date(), '（架空）よく食べます😊\nよく寝ます🐾✨\n遊びます💦')
      const bodyPart = text.split(closing)[0]
      out[closing] = { total: (text.match(E) ?? []).length, closingKept: text.includes(closing), closingEmoji: (closing.match(E) ?? []).length, bodyEmoji: (bodyPart.match(E) ?? []).length, firstKept: bodyPart.includes('😊') }
    }
    return out
  })
  const rows = r ? Object.entries(r) : null
  if (rows) {
  ok(rows.length === 4, `決まった文の4つを全部試した（${rows.length}）`)
  ok(rows.every(([, v]) => v.total <= 2), `投稿文全体の絵文字は、決まった文も含めて2つまで（${rows.map(([, v]) => v.total).join('・')}）`)
  ok(rows.every(([, v]) => v.closingKept && v.bodyEmoji === 2 - v.closingEmoji && v.firstKept), `決まった文の絵文字は消さず、本文の後ろから消す（本文の初めの絵文字は残る。決まった文に絵文字がなければ本文に2つ。${rows.map(([, v]) => v.closingEmoji + '+' + v.bodyEmoji).join('・')}）`)
  }
}
let sent = null
let answer = 'ok'
await p.route('**/api/post', async (route) => {
  sent = JSON.parse(route.request().postData() ?? '{}')
  if (answer === 'fail') return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'api' }) })
  const body = '（仮の本文）ごはんをよく食べるようになったミント。\nトイレも上手にできます。'
  await new Promise((r) => setTimeout(r, 300))
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      result: {
        body,
        parts: [{ text: body, cites: [{ doc: 0, start: 1, end: 2, text: 'ごはんをよく食べます。' }] }],
        memoChunks: splitMemo(sent.memo),
        factChunks: factChunks(sent.facts),
      },
    }),
  })
})
const dummy = { name: 'p.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#8fa9a3"/></svg>') }
await p.goto(url)
await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
await p.getByLabel('団体名').fill('テスト保護猫の会')
await p.getByLabel('連絡先').fill('（架空）DMでお問い合わせください')
await p.getByRole('button', { name: '登録して始める' }).click()
await p.getByRole('button', { name: '新しい子を紹介' }).click()
await p.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
await p.locator('.photo img').first().waitFor()
await p.getByLabel('預かりさんからのLINE・メモ').fill('（架空）ミントの近況です！ごはんをよく食べます。連絡は 090-1234-5678 まで')
await p.getByRole('textbox', { name: /^名前/ }).fill('ミント')
await p.getByLabel('いいところ').fill('ごはんをよく食べる')
await p.getByRole('button', { name: '次へ' }).click()
await p.getByRole('button', { name: '物語の本文を書いてもらう' }).waitFor() // 確認画面が出てから読む（［次へ］は入力を確定してから1拍おいて進む）
const post = p.locator('.field textarea').last()
await post.waitFor()
const before = await post.inputValue()
ok(before.includes('・ごはんをよく食べる'), 'はじめは決まった形の投稿文（いいところの箇条書き）')

await p.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
await p.getByRole('button', { name: '本文を書いています…' }).waitFor({ timeout: 2000 }).catch(() => {})
await p.getByRole('button', { name: '物語の本文を書いてもらう' }).waitFor()
const after = await post.inputValue()
ok(sent && !sent.memo.includes('090-1234-5678') && sent.memo.includes('［電話番号］'), '送るメモでは電話番号を伏せる')
ok(sent && sent.facts.name === 'ミント' && sent.facts.goodPoints[0] === 'ごはんをよく食べる' && Object.keys(sent).sort().join() === 'facts,memo', '送るのはメモと、名前・いいところだけ')
ok(after.startsWith('【ミント】') && after.includes('（仮の本文）ごはんをよく食べるようになったミント。\nトイレも上手にできます。'), '本文が名前の下に入る')
ok(CLOSINGS.some((f) => after.includes('トイレも上手にできます。\n' + f('ミント'))), '本文のすぐあとに、決まった文（4つのどれか）をプログラムが足す')
ok(!after.includes('・ごはんをよく食べる'), '本文があるときは、いいところの箇条書きの代わりに本文を入れる')
ok(after.includes('お問い合わせ：（架空）DMでお問い合わせください'), '連絡先はプログラムが足す')
await p.screenshot({ path: join(outDir, '16a_投稿文_本文.png'), fullPage: true })

// 手で直したあとは、聞いてから置きかえる。［やめる］なら置きかえない
await post.fill(after + '\n（手で足した行）')
await p.evaluate(() => {
  window.__confirmAnswer = 'no'
  window.__asked = ''
})
sent = null
await p.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
await p.waitForTimeout(800)
ok((await p.evaluate(() => window.__asked ?? '')).includes('投稿文を手で直しています'), '手で直したあとは、置きかえる前に聞く')
ok(sent === null && (await post.inputValue()).includes('（手で足した行）'), '［やめる］なら送らず、手で直した文のまま')
await p.evaluate(() => (window.__confirmAnswer = 'yes'))

// Claudeが使えないとき：決まった形のまま、知らせる
answer = 'fail'
await post.fill(before)
await p.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
await p.getByText('本文を書けませんでした。').waitFor({ timeout: 3000 }).catch(() => {})
ok(await p.getByText('本文を書けませんでした。下の投稿文は決まった形のままです。').isVisible(), 'Claudeが使えないときは知らせる')
ok((await post.inputValue()) === before, 'そのときも投稿文は決まった形のまま')
await p.screenshot({ path: join(outDir, '16b_投稿文_書けなかった.png'), fullPage: true })


// ── 根拠の確認（#17）：文ごとの印・メモが光る・［消す］［本当です（残す）］・印が残っている間は［動画を作る］を押せない・入力の途中に残る ──
{
  const ctx2 = await browser.newContext({ ...devices['iPhone 15'] })
  await ctx2.addInitScript(() => {
    new MutationObserver(() => {
      const d = document.querySelector('[data-confirm-dialog]')
      if (d && !d.dataset.answered) {
        d.dataset.answered = '1'
        setTimeout(() => d.querySelector('[data-confirm="yes"]')?.click(), 50)
      }
    }).observe(document, { childList: true, subtree: true })
  })
  const q = await ctx2.newPage()
  let checkMode = 'flag' // flag：2文目に印 ／ fail：確かめられない ／ ok：全部あり
  let checkSent = null
  let checkCalls = 0
  const BODY = '（仮の本文）ごはんをよく食べるようになったミント。\nトイレも上手にできます🐾'
  await q.route('**/api/post', async (route) => {
    const sent = JSON.parse(route.request().postData() ?? '{}')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: { body: BODY, parts: [{ text: BODY, cites: [{ doc: 0, start: 1, end: 2, text: 'ごはんをよく食べます。' }] }], memoChunks: splitMemo(sent.memo), factChunks: factChunks(sent.facts) } }),
    })
  })
  await q.route('**/api/check', async (route) => {
    checkSent = JSON.parse(route.request().postData() ?? '{}')
    checkCalls++
    await new Promise((r) => setTimeout(r, 300))
    if (checkMode === 'fail') return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'api' }) })
    const results = checkSent.sentences.map((_, i) =>
      checkMode === 'flag' && i === 1
        ? { i, ok: false, cites: [], reason: '上手にできます' }
        : { i, ok: true, cites: [{ doc: 0, start: 1, end: 2, text: 'ごはんをよく食べます。' }], reason: '' },
    )
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) })
  })
  await q.goto(url)
  await q.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await q.getByLabel('団体名').fill('テスト保護猫の会')
  await q.getByRole('button', { name: '登録して始める' }).click()
  await q.getByRole('button', { name: '新しい子を紹介' }).click()
  await q.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
  await q.locator('.photo img').first().waitFor()
  await q.getByLabel('預かりさんからのLINE・メモ').fill('（架空）ミントの近況です！ごはんをよく食べます。トイレも上手です。')
  await q.getByRole('textbox', { name: /^名前/ }).fill('ミント')
  await q.getByRole('button', { name: '次へ' }).click()
  const save = q.getByRole('button', { name: '動画を作る' })
  const postBox = q.locator('.field textarea').last()
  await q.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await q.getByText('メモに根拠があるか、1文ずつ確かめています').waitFor({ timeout: 3000 }).catch(() => {})
  ok(await save.isDisabled(), '確かめている間は［動画を作る］を押せない')
  await q.locator('.story-line').first().waitFor({ timeout: 5000 }).catch(() => {})
  ok(checkSent && JSON.stringify(checkSent.sentences) === JSON.stringify(['（仮の本文）ごはんをよく食べるようになったミント。', 'トイレも上手にできます🐾']), `本文を1文ずつ送って確かめる（${JSON.stringify(checkSent?.sentences)}）`)
  ok(checkSent && !('post' in checkSent) && Object.keys(checkSent).sort().join() === 'facts,memo,sentences', '確かめるのに送るのは、メモ・名前といいところ・本文の文だけ（引用は送らない）')
  ok((await q.locator('.story-line[data-flag="1"]').count()) === 1 && (await q.getByText('⚠ メモにありません（上手にできます）').isVisible()), '根拠のない文に黄色の印と「⚠ メモにありません」')
  ok(await save.isDisabled(), '印の文が残っている間は［動画を作る］を押せない')
  ok(await q.getByText('印の文があと1つあります。').isVisible(), '「印の文があと1つあります」と出る')
  ok(await q.getByText('決まった文').isVisible(), '最後の決まった文には「決まった文」と出て、印は付かない')
  // 文を押すと、メモの根拠が光る
  await q.locator('.story-line').first().locator('.story-text').click()
  ok((await q.locator('.story-memo mark.story-lit').count()) >= 1 && (await q.locator('.story-memo mark.story-lit').first().textContent()) === 'ごはんをよく食べます。', '根拠のある文を押すと、メモの中の根拠の言葉が光る')
  await q.screenshot({ path: join(outDir, '17a_根拠の印.png'), fullPage: true })
  // 読み込み直しても、印と結果が残る（入力の途中に残す）
  await q.waitForTimeout(800)
  await q.reload()
  await q.locator('.story-line').first().waitFor({ timeout: 8000 }).catch(() => {})
  ok((await q.locator('.story-line[data-flag="1"]').count()) === 1 && (await save.isDisabled()), '読み込み直しても、印の文と［動画を作る］を押せないことが残る')
  ok(checkCalls === 1, `読み込み直しても、もう一度確かめない（確かめた回数 ${checkCalls}）`)
  // 前の版の画面が入力の途中（'main'）を書き直しても、確認の結果は消えない（見直しの中8）
  await q.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('hogoneko-card')
        r.onsuccess = () => {
          const st = r.result.transaction('drafts', 'readwrite').objectStore('drafts')
          const g = st.get('main')
          g.onsuccess = () => {
            const { story: _s, ...old } = g.result
            st.put({ ...old, savedAt: Date.now() }, 'main').onsuccess = () => res()
          }
        }
      }),
  )
  await q.reload()
  await q.locator('.story-line').first().waitFor({ timeout: 8000 }).catch(() => {})
  ok((await q.locator('.story-line[data-flag="1"]').count()) === 1 && (await save.isDisabled()), '前の版の画面が入力の途中を書き直しても、印の文と押せないことが残る（見直しの中8）')
  // ［本当です（残す）］で押せるようになり、読み込み直してもそのまま
  await q.getByRole('button', { name: '本当です（残す）' }).click()
  ok(await save.isEnabled(), '［本当です（残す）］を押すと、［動画を作る］を押せる')
  await q.waitForTimeout(800)
  await q.reload()
  await save.waitFor({ timeout: 8000 }).catch(() => {})
  await q.waitForTimeout(500)
  ok(await save.isEnabled(), '読み込み直しても「残す」を選んだことが残る')

  // Claudeの本文で作った投稿文は「手で直した」にならない：［戻る］→［次へ］で聞かれず、本文と確認の結果が残る（見直しの中9）
  await q.evaluate(() => (window.__askedCount = 0))
  await q.evaluate(() => {
    new MutationObserver(() => {
      if (document.querySelector('[data-confirm-dialog]')) window.__askedCount = (window.__askedCount ?? 0) + 1
    }).observe(document, { childList: true, subtree: true })
  })
  await q.getByRole('button', { name: '戻る' }).click()
  await q.getByRole('button', { name: '次へ' }).click()
  await q.locator('.story-line').first().waitFor({ timeout: 5000 }).catch(() => {})
  await q.waitForFunction(() => !document.querySelector('.bottom-bar .btn-primary')?.disabled, null, { timeout: 4000 }).catch(() => {})
  const blockedMsg = await q.locator('[data-story-blocked]').textContent().catch(() => '')
  const dbg9 = [await q.evaluate(() => window.__askedCount), (await postBox.inputValue()).includes('（仮の本文）'), await save.isEnabled()]
  ok(dbg9[0] === 0 && dbg9[1] && dbg9[2], `本文を書いてもらっただけなら、［戻る］→［次へ］で聞かれず、本文と「残す」も残る（${dbg9.join('/')}${blockedMsg ? '・' + blockedMsg : ''}）`)

  // ［消す］：もう一度書いてもらい、印の文を消す
  checkMode = 'flag'
  await q.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await q.locator('.story-line[data-flag="1"]').waitFor({ timeout: 5000 }).catch(() => {})
  await q.getByRole('button', { name: '消す' }).click()
  ok(!(await postBox.inputValue()).includes('トイレも上手にできます') && (await postBox.inputValue()).includes('ごはんをよく食べるようになったミント。'), '［消す］で、その文だけ投稿文から消える')
  ok(await save.isEnabled(), '印の文を消すと、［動画を作る］を押せる')

  // 確かめられないとき：押せない → ［本文を外して、決まった形に戻す］で押せる
  checkMode = 'fail'
  await q.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await q.getByText('本文の根拠を確かめられませんでした。確かめるまで［動画を作る］は押せません。').waitFor({ timeout: 5000 }).catch(() => {})
  ok(await q.getByText('本文の根拠を確かめられませんでした。確かめるまで［動画を作る］は押せません。').isVisible() && (await save.isDisabled()), '確かめられないときは知らせて、［動画を作る］を押せない')
  await q.screenshot({ path: join(outDir, '17b_根拠を確かめられない.png'), fullPage: true })
  await q.getByRole('button', { name: '本文を外して、決まった形に戻す' }).click()
  ok(!(await postBox.inputValue()).includes('（仮の本文）') && (await save.isEnabled()), '［本文を外して、決まった形に戻す］で、決まった形の投稿文に戻り、押せる')

  // ［もう一度確かめる］
  checkMode = 'fail'
  await q.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await q.getByRole('button', { name: 'もう一度確かめる' }).waitFor({ timeout: 5000 }).catch(() => {})
  checkMode = 'ok'
  await q.getByRole('button', { name: 'もう一度確かめる' }).click()
  await q.locator('.story-line').first().waitFor({ timeout: 5000 }).catch(() => {})
  await q.waitForTimeout(500)
  ok((await q.locator('.story-line[data-flag="1"]').count()) === 0 && (await save.isEnabled()), '［もう一度確かめる］で確かめられ、印がなければ押せる')

  // 投稿文を全部手で書き直したら、確認は要らない（本文が残っていない）
  checkMode = 'flag'
  await q.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await q.locator('.story-line[data-flag="1"]').waitFor({ timeout: 5000 }).catch(() => {})
  await postBox.fill(await postBox.inputValue().then((v) => v.replace('トイレも上手にできます🐾', 'トイレも上手にできます！')))
  ok(await save.isDisabled() && (await q.getByText('この文は投稿文で直されています。').isVisible()), '印の文を手で直しても、印は残り押せない（見直しの重い3・4）')
  await q.getByRole('button', { name: '本当です（残す）' }).click()
  ok(await save.isEnabled(), '直した文を確かめて［本当です（残す）］を押すと、押せる')
  // 確かめている間に別の本文を書いてもらったとき、前の確かめの結果を新しい本文に入れない（見直しの重い1）
  checkMode = 'slow-ok-then-flag'
  await ctx2.close()
}

{
  const ctx3 = await browser.newContext({ ...devices['iPhone 15'] })
  await ctx3.addInitScript(() => {
    new MutationObserver(() => {
      const d = document.querySelector('[data-confirm-dialog]')
      if (d && !d.dataset.answered) {
        d.dataset.answered = '1'
        setTimeout(() => d.querySelector('[data-confirm="yes"]')?.click(), 50)
      }
    }).observe(document, { childList: true, subtree: true })
  })
  const r = await ctx3.newPage()
  let n = 0
  await r.route('**/api/post', async (route) => {
    const sent = JSON.parse(route.request().postData() ?? '{}')
    n++
    const body = n === 1 ? '（仮の本文A）よく食べます。' : '（仮の本文B）よく眠ります。\nとっても甘えん坊です。'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { body, parts: [{ text: body, cites: [] }], memoChunks: splitMemo(sent.memo), factChunks: factChunks(sent.facts) } }) })
  })
  await r.route('**/api/check', async (route) => {
    const sent = JSON.parse(route.request().postData() ?? '{}')
    const isA = sent.sentences[0].includes('本文A')
    // A はゆっくり（全部あり）、B は速く（2文目に印）
    await new Promise((res) => setTimeout(res, isA ? 2500 : 300))
    const results = sent.sentences.map((_, i) => (!isA && i === 1 ? { i, ok: false, cites: [], reason: 'とっても' } : { i, ok: true, cites: [{ doc: 0, start: 0, end: 1, text: 'x' }], reason: '' }))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) })
  })
  await r.goto(url)
  await r.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await r.getByLabel('団体名').fill('テスト保護猫の会')
  await r.getByRole('button', { name: '登録して始める' }).click()
  await r.getByRole('button', { name: '新しい子を紹介' }).click()
  await r.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
  await r.locator('.photo img').first().waitFor()
  await r.getByLabel('預かりさんからのLINE・メモ').fill('（架空）よく食べます。よく眠ります。')
  await r.getByRole('textbox', { name: /^名前/ }).fill('ミント')
  await r.getByRole('button', { name: '次へ' }).click()
  await r.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await r.getByText('メモに根拠があるか、1文ずつ確かめています').waitFor({ timeout: 3000 }).catch(() => {})
  // A を確かめている間に、もう一度書いてもらう（B）
  await r.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await r.waitForTimeout(3500) // A の遅い答えも届くまで待つ
  const save2 = r.getByRole('button', { name: '動画を作る' })
  ok((await r.locator('.field textarea').last().inputValue()).includes('本文B') && (await r.locator('.story-line[data-flag="1"]').count()) === 1 && (await save2.isDisabled()), '確かめている間に本文が替わっても、前の結果を入れず、新しい本文の印が残る（見直しの重い1）')
  await ctx3.close()
}

// 本文を確かめたあとでメモが変わったら、✓ を消し、［動画を作る］を押せなくし、確かめ直せる（#23 重い1。11/7 作者の決定）
{
  const ctx4 = await browser.newContext({ ...devices['iPhone 15'] })
  const s4 = await ctx4.newPage()
  const checks = []
  await s4.route('**/api/post', async (route) => {
    const sent = JSON.parse(route.request().postData() ?? '{}')
    const body = '（仮の本文）よく食べる子です。'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { body, parts: [{ text: body, cites: [{ doc: 0, start: 0, end: 1, text: 'x' }] }], memoChunks: splitMemo(sent.memo), factChunks: factChunks(sent.facts) } }) })
  })
  let failNext = false
  await s4.route('**/api/check', async (route) => {
    if (failNext) {
      failNext = false
      return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'api' }) })
    }
    const sent = JSON.parse(route.request().postData() ?? '{}')
    checks.push(sent)
    const results = sent.sentences.map((_, i) => ({ i, ok: true, cites: [{ doc: 0, start: 0, end: 1, text: 'x' }], reason: '' }))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) })
  })
  await s4.goto(url)
  await s4.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await s4.getByLabel('団体名').fill('テスト保護猫の会')
  await s4.getByRole('button', { name: '登録して始める' }).click()
  await s4.getByRole('button', { name: '新しい子を紹介' }).click()
  await s4.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
  await s4.locator('.photo img').first().waitFor()
  const MEMO4 = '（架空）よく食べます。'
  await s4.getByLabel('預かりさんからのLINE・メモ').fill(MEMO4)
  await s4.getByRole('textbox', { name: /^名前/ }).fill('ミント')
  await s4.getByRole('button', { name: '次へ' }).click()
  const save4 = s4.getByRole('button', { name: '動画を作る' })
  await s4.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await s4.locator('.story-line').first().waitFor({ timeout: 5000 }).catch(() => {})
  await s4.waitForTimeout(400)
  ok((await save4.isEnabled()) && (await s4.locator('.story-text', { hasText: '✓' }).count()) === 1, '確かめ終わると ✓ が出て、［動画を作る］を押せる')
  // 空行・空白だけの違いは、同じメモとみなす
  await s4.getByRole('button', { name: '戻る' }).click()
  await s4.getByLabel('預かりさんからのLINE・メモ').fill(MEMO4 + '\n\n')
  await s4.getByRole('button', { name: '次へ' }).click()
  await s4.waitForTimeout(500)
  ok((await s4.locator('[data-story-stale]').count()) === 0 && (await save4.isEnabled()), '空行を足しただけなら、確かめ直さなくてよい')
  // メモを変える
  await s4.getByRole('button', { name: '戻る' }).click()
  await s4.getByLabel('預かりさんからのLINE・メモ').fill(MEMO4 + '（架空）よく眠ります。')
  await s4.getByRole('button', { name: '次へ' }).click()
  await s4.waitForTimeout(500)
  ok(await s4.getByText('メモが変わりました。もう一度確かめてください。').isVisible(), 'メモが変わったら「メモが変わりました。もう一度確かめてください」と出る')
  ok((await s4.locator('.story-text', { hasText: '✓' }).count()) === 0, 'メモが変わったら、✓ を消す')
  ok(await save4.isDisabled(), 'メモが変わったら、確かめ直すまで［動画を作る］を押せない')
  await s4.screenshot({ path: join(outDir, '17e_メモが変わった.png'), fullPage: true })
  // 確かめ直しに失敗したら、そのことを出す（見直しの中1）
  failNext = true
  await s4.getByRole('button', { name: 'もう一度確かめる' }).first().click()
  await s4.getByText('本文の根拠を確かめられませんでした。もう一度押してください。').waitFor({ timeout: 4000 }).catch(() => {})
  ok((await s4.getByText('本文の根拠を確かめられませんでした。もう一度押してください。').isVisible()) && (await save4.isDisabled()), '確かめ直しに失敗したら、そのことを出し、［動画を作る］は押せないまま')
  const before = checks.length
  await s4.getByRole('button', { name: 'もう一度確かめる' }).first().click()
  await s4.locator('.story-line').first().waitFor({ timeout: 5000 }).catch(() => {})
  await s4.waitForTimeout(400)
  ok(checks.length === before + 1 && checks.at(-1).memo.includes('よく眠ります'), 'ボタンで確かめ直すと、今のメモで確かめる')
  ok((await s4.locator('[data-story-stale]').count()) === 0 && (await save4.isEnabled()) && (await s4.locator('.story-text', { hasText: '✓' }).count()) === 1, '確かめ直すと ✓ が戻り、［動画を作る］を押せる')
  await s4.waitForTimeout(800)
  await s4.reload()
  await s4.getByRole('button', { name: '動画を作る' }).waitFor({ timeout: 8000 }).catch(() => {})
  ok((await s4.locator('[data-story-stale]').count()) === 0, '確かめ直した結果も、入力の途中に残る（読み込み直しても「メモが変わりました」は出ない）')
  // 名前・「いいところ」が変わったときも、✓ を消して確かめ直す（11/7 作者の決定。案B）
  const FACT_MSG = '名前か「いいところ」が変わりました。もう一度確かめてください。'
  await s4.getByRole('button', { name: '戻る' }).click()
  await s4.getByRole('textbox', { name: /^名前/ }).fill('ミント ')
  await s4.getByLabel('いいところ').fill('\n')
  await s4.getByRole('button', { name: '次へ' }).click()
  await s4.waitForTimeout(500)
  ok((await s4.locator('[data-story-stale]').count()) === 0 && (await save4.isEnabled()), '名前の前後の空白・空の「いいところ」の行だけなら、確かめ直さなくてよい')
  await s4.getByRole('button', { name: '戻る' }).click()
  await s4.getByRole('textbox', { name: /^名前/ }).fill('ミルク')
  await s4.getByRole('button', { name: '次へ' }).click()
  await s4.waitForTimeout(500)
  ok(await s4.getByText(FACT_MSG).isVisible(), '名前が変わったら「名前か「いいところ」が変わりました。もう一度確かめてください」と出る')
  ok((await s4.locator('.story-text', { hasText: '✓' }).count()) === 0 && (await save4.isDisabled()), '名前が変わったら、✓ を消し、確かめ直すまで［動画を作る］を押せない')
  ok(await s4.locator('[data-story-blocked]', { hasText: '名前か「いいところ」が変わりました。上の［もう一度確かめる］を押してください。' }).isVisible(), '名前が変わったら、下の帯にも同じことを出す')
  await s4.screenshot({ path: join(outDir, '17f_名前が変わった.png'), fullPage: true })
  const before2 = checks.length
  await s4.getByRole('button', { name: 'もう一度確かめる' }).first().click()
  await s4.locator('.story-line').first().waitFor({ timeout: 5000 }).catch(() => {})
  await s4.waitForTimeout(400)
  ok(checks.length === before2 + 1 && checks.at(-1).facts?.name === 'ミルク', '確かめ直すと、今の名前で確かめる')
  ok((await s4.locator('[data-story-stale]').count()) === 0 && (await save4.isEnabled()), '名前のあとに確かめ直すと、［動画を作る］を押せる')
  await s4.getByRole('button', { name: '戻る' }).click()
  await s4.getByLabel('いいところ').fill('よく食べる')
  await s4.getByRole('button', { name: '次へ' }).click()
  await s4.waitForTimeout(500)
  ok((await s4.getByText(FACT_MSG).isVisible()) && (await save4.isDisabled()), '「いいところ」が変わったときも、✓ を消して確かめ直してもらう')
  await s4.getByRole('button', { name: 'もう一度確かめる' }).first().click()
  await s4.locator('.story-line').first().waitFor({ timeout: 5000 }).catch(() => {})
  await s4.waitForTimeout(400)
  ok(JSON.stringify(checks.at(-1).facts?.goodPoints) === JSON.stringify(['よく食べる']) && (await save4.isEnabled()), '確かめ直すと、今の「いいところ」で確かめ、［動画を作る］を押せる')
  await s4.waitForTimeout(800)
  await s4.reload()
  await s4.getByRole('button', { name: '動画を作る' }).waitFor({ timeout: 8000 }).catch(() => {})
  ok((await s4.locator('[data-story-stale]').count()) === 0, '名前・いいところで確かめ直した結果も、読み込み直したあとに残る')
  // メモと名前の両方が変わったときは、メモの文を出す
  await s4.getByRole('button', { name: '戻る' }).click()
  await s4.getByLabel('預かりさんからのLINE・メモ').fill(MEMO4)
  await s4.getByRole('textbox', { name: /^名前/ }).fill('ミント')
  await s4.getByRole('button', { name: '次へ' }).click()
  await s4.waitForTimeout(500)
  ok(await s4.getByText('メモが変わりました。もう一度確かめてください。').isVisible(), 'メモと名前の両方が変わったら「メモが変わりました」と出る')
  await ctx4.close()
}

// 作者が iPhone（Chrome）で見つけた手順と同じ流れ（11/7）：読み取り → 名前「モカ」→ 本文 → ✓ →［戻る］でメモの最後に1文足す →［次へ］
// iPhone の日本語入力では、変換を確定する前に［次へ］を押すと、欄に見えている文字の入力の知らせが、画面が進んだあとに届く。
// その形（欄には見えているが、入力の知らせがまだ届いていない）も確かめる
for (const how of ['確定した文字', '変換を確定する前の文字']) {
  const ctx6 = await browser.newContext({ ...devices['iPhone 15'] })
  const s6 = await ctx6.newPage()
  await s6.route('**/api/read', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { name: { value: 'モカ', source: 'モカは' }, sex: null, age: null, vaccine: null, neuter: null, virusTest: null, goodPoints: [], carerWords: null }, dropped: [] }) }))
  await s6.route('**/api/ask', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ question: null, skipped: 'not-needed' }) }))
  await s6.route('**/api/post', async (r) => {
    const sent = JSON.parse(r.request().postData() ?? '{}')
    const body = '（仮の本文）モカは毎朝お迎えに来てくれます。'
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { body, parts: [{ text: body, cites: [] }], memoChunks: splitMemo(sent.memo), factChunks: factChunks(sent.facts) } }) })
  })
  await s6.route('**/api/check', async (r) => {
    const sent = JSON.parse(r.request().postData() ?? '{}')
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: sent.sentences.map((_, i) => ({ i, ok: true, cites: [{ doc: 0, start: 0, end: 1, text: 'x' }], reason: '' })) }) })
  })
  await s6.goto(url)
  await s6.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await s6.getByLabel('団体名').fill('テスト保護猫の会')
  await s6.getByRole('button', { name: '登録して始める' }).click()
  await s6.getByRole('button', { name: '新しい子を紹介' }).click()
  await s6.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
  await s6.locator('.photo img').first().waitFor()
  const memo6 = s6.getByLabel('預かりさんからのLINE・メモ')
  await memo6.fill('（架空）モカは毎朝お迎えに来てくれます。ごはんもよく食べます。')
  await s6.getByRole('button', { name: 'メッセージから読み取る' }).click()
  await s6.waitForTimeout(800)
  await s6.getByRole('button', { name: '次へ' }).click()
  await s6.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await s6.locator('.story-line').first().waitFor({ timeout: 5000 }).catch(() => {})
  await s6.waitForTimeout(400)
  const save6 = s6.getByRole('button', { name: '動画を作る' })
  const okBefore = (await s6.locator('.story-text', { hasText: '✓' }).count()) === 1 && (await save6.isEnabled())
  await s6.getByRole('button', { name: '戻る' }).click()
  await memo6.click()
  await s6.evaluate(() => {
    const t = document.querySelector('textarea')
    t.selectionStart = t.selectionEnd = t.value.length
  })
  if (how === '確定した文字') await s6.keyboard.type('夜は静かに寝ています')
  else
    await s6.evaluate(() => {
      const t = document.querySelector('textarea')
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      setValue.call(t, t.value + '夜は静かに寝ています') // 入力の知らせ（input）は送らない
    })
  await s6.getByRole('button', { name: '次へ' }).click()
  await s6.waitForTimeout(600)
  ok(okBefore && (await s6.getByText('メモが変わりました。もう一度確かめてください。').isVisible()) && (await save6.isDisabled()) && (await s6.locator('.story-text', { hasText: '✓' }).count()) === 0, `作者の手順（${how}）：メモの最後に1文足して［次へ］→「メモが変わりました」が出て ✓ が消え、［動画を作る］を押せない`)
  await s6.getByRole('button', { name: '戻る' }).click()
  ok((await memo6.inputValue()).endsWith('ごはんもよく食べます。夜は静かに寝ています'), `作者の手順（${how}）：足した文は、［戻る］で戻ってもメモの欄に残っている`)
  await ctx6.close()
}

// 変換を確定する前の文字（欄には見えているが、入力の知らせがまだ届いていない）のまま、
// ［メッセージから読み取る］［動画を作る］を押したときも、欄に見えている文字を使う（11/7 作者の指示）
{
  const ctx7 = await browser.newContext({ ...devices['iPhone 15'] })
  await ctx7.addInitScript(() => {
    window.__copied = null
    try {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => void (window.__copied = t) }, configurable: true })
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    } catch {
      // そのまま
    }
  })
  const s7 = await ctx7.newPage()
  const readSent = []
  await s7.route('**/api/read', (r) => {
    readSent.push(JSON.parse(r.request().postData() ?? '{}').memo)
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { name: { value: 'モカ', source: 'モカは' }, sex: null, age: null, vaccine: null, neuter: null, virusTest: null, goodPoints: [], carerWords: null }, dropped: [] }) })
  })
  await s7.route('**/api/ask', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ question: null, skipped: 'not-needed' }) }))
  // endOnBlur：欄から離れたときに変換が終わる形にするか（false なら、入力の知らせも変換の終わりも届かない、いちばん悪い形）
  const typeUncommitted = (selector, add, endOnBlur = true) =>
    s7.evaluate(
      ([sel, text, end]) => {
        const t = sel === 'last' ? [...document.querySelectorAll('textarea')].at(-1) : document.querySelector(sel)
        t.focus()
        const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        setValue.call(t, t.value + text) // 入力の知らせ（input）は送らない
        // 欄から離れたら、変換は終わる（入力の知らせは届かないまま）
        if (end) t.addEventListener('blur', () => t.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text })), { once: true })
      },
      [selector, add, endOnBlur],
    )
  await s7.goto(url)
  await s7.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await s7.getByLabel('団体名').fill('テスト保護猫の会')
  await s7.getByRole('button', { name: '登録して始める' }).click()
  await s7.getByRole('button', { name: '新しい子を紹介' }).click()
  await s7.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
  await s7.locator('.photo img').first().waitFor()
  await s7.getByLabel('預かりさんからのLINE・メモ').fill('（架空）モカは毎朝お迎えに来てくれます。')
  await typeUncommitted('textarea', '夜は静かに寝ています', false)
  await s7.getByRole('button', { name: 'メッセージから読み取る' }).click()
  await s7.waitForTimeout(800)
  ok(readSent.length === 1 && readSent[0].endsWith('夜は静かに寝ています'), `変換を確定する前の文字のまま［メッセージから読み取る］を押しても、欄に見えている文字まで読み取りに送る（${JSON.stringify(readSent[0] ?? '')}）`)
  await s7.getByRole('button', { name: '次へ' }).click()
  await s7.getByRole('button', { name: '動画を作る' }).waitFor()
  await s7.waitForTimeout(500)
  // ハッシュタグを6こにしたまま押したら、作らない（確定してから確かめ直す）
  await typeUncommitted('last', '\n#a #b #c #d #e #f')
  await s7.getByRole('button', { name: '動画を作る' }).click()
  await s7.waitForTimeout(600)
  ok((await s7.getByRole('heading', { name: /できあがり|保存/ }).count()) === 0 && (await s7.getByText(/ハッシュタグが\d+こあります/).isVisible()), '変換を確定する前の文字でハッシュタグが6こになっていたら、［動画を作る］を押しても作らず、知らせる')
  const box7 = s7.getByLabel('投稿文（その場で直せます）')
  await box7.fill((await box7.inputValue()).replace('\n#a #b #c #d #e #f', ''))
  await typeUncommitted('last', '\n（確定前の行）')
  await s7.getByRole('button', { name: '動画を作る' }).click()
  const share7 = s7.getByRole('button', { name: '投稿文をコピーしてInstagramへ' })
  await share7.waitFor({ timeout: 90000 }).catch(() => {})
  for (let k = 0; k < 90 && !(await share7.isEnabled().catch(() => false)); k++) await s7.waitForTimeout(1000)
  await share7.click().catch(() => {})
  await s7.waitForTimeout(500)
  const copied7 = (await s7.evaluate(() => window.__copied)) ?? ''
  ok(copied7.includes('（確定前の行）'), `変換を確定する前の文字のまま［動画を作る］を押しても、欄に見えている投稿文で作る（コピーされた投稿文に入っている：${copied7.includes('（確定前の行）')}）`)
  await ctx7.close()
}

// 本文を書いている間に［戻る］で入力を変えても、届いた本文の投稿文は今の入力で組み立てる（#23のあとの見直しの重い1。11/7 作者のOK）
// 本文が届いたあとに名前を変えたら、投稿文の頭の【名前】と最後の決まった文を今の名前にする（手で直した投稿文でも。11/7 作者の決定）
{
  const ctx5 = await browser.newContext({ ...devices['iPhone 15'] })
  await ctx5.addInitScript(() => {
    window.__askedCount = 0
    new MutationObserver(() => {
      const d = document.querySelector('[data-confirm-dialog]')
      if (d && !d.dataset.answered) {
        d.dataset.answered = '1'
        window.__askedCount += 1
        window.__asked = d.textContent
        setTimeout(() => d.querySelector(window.__confirmAnswer === 'no' ? '[data-confirm="no"]' : '[data-confirm="yes"]')?.click(), 50)
      }
    }).observe(document, { childList: true, subtree: true })
  })
  const s5 = await ctx5.newPage()
  let delay = 2500
  await s5.route('**/api/post', async (route) => {
    const sent = JSON.parse(route.request().postData() ?? '{}')
    await new Promise((r) => setTimeout(r, delay))
    const body = '（仮の本文）ミントはよく食べる子です。\n（仮の本文）夜はよく眠ります。'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { body, parts: [{ text: body, cites: [] }], memoChunks: splitMemo(sent.memo), factChunks: factChunks(sent.facts) } }) }).catch(() => {})
  })
  await s5.route('**/api/check', async (route) => {
    const sent = JSON.parse(route.request().postData() ?? '{}')
    const results = sent.sentences.map((_, i) => ({ i, ok: true, cites: [{ doc: 0, start: 0, end: 1, text: 'x' }], reason: '' }))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) })
  })
  await s5.goto(url)
  await s5.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await s5.getByLabel('団体名').fill('テスト保護猫の会')
  await s5.getByRole('button', { name: '登録して始める' }).click()
  await s5.getByRole('button', { name: '新しい子を紹介' }).click()
  await s5.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
  await s5.locator('.photo img').first().waitFor()
  await s5.getByLabel('預かりさんからのLINE・メモ').fill('（架空）ミントはよく食べます。夜はよく眠ります。')
  await s5.getByRole('textbox', { name: /^名前/ }).fill('ミント')
  await s5.getByRole('group', { name: '性別' }).getByRole('button', { name: 'オス' }).click()
  await s5.getByRole('button', { name: '次へ' }).click()
  const postBox = s5.getByLabel('投稿文（その場で直せます）')
  await s5.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await s5.waitForTimeout(300)
  await s5.getByRole('button', { name: '戻る' }).click()
  await s5.getByRole('group', { name: '性別' }).getByRole('button', { name: 'メス' }).click()
  await s5.getByRole('button', { name: '次へ' }).click()
  await s5.waitForTimeout(3500)
  const p1 = await postBox.inputValue()
  ok(p1.includes('（仮の本文）ミントはよく食べる子です。') && p1.split('\n')[1]?.includes('メス') && !p1.includes('オス'), `本文を書いている間に性別を変えても、届いた本文の投稿文は今の性別で組み立てる（${JSON.stringify(p1.split('\n').slice(0, 2))}）`)
  ok((await s5.evaluate(() => window.__askedCount)) === 0, '入力を変えて投稿文が作り直されただけなら、「投稿文が直されました」と聞かない')
  ok((await s5.getByRole('button', { name: '動画を作る' }).isEnabled()) && (await s5.locator('[data-story-stale]').count()) === 0, '性別だけなら、確かめ直さなくてよい')
  // 書いている間に手で直したら、今までどおり聞く
  delay = 1500
  await s5.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await s5.waitForTimeout(300)
  await s5.evaluate(() => (window.__confirmAnswer = 'no'))
  await postBox.fill((await postBox.inputValue()) + '\n（手で足した行）')
  await s5.waitForTimeout(2200)
  ok((await s5.evaluate(() => window.__askedCount)) === 1 && (await postBox.inputValue()).includes('（手で足した行）'), '書いている間に投稿文を手で直したら、今までどおり聞き、［やめる］なら直した文のまま')
  await s5.evaluate(() => (window.__confirmAnswer = 'yes'))
  // 書いている間に名前を変えたら、頭と決まった文は今の名前。本文の確認は「名前か「いいところ」が変わりました」で止まる
  delay = 2500
  await s5.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await s5.waitForTimeout(800)
  await s5.getByRole('button', { name: '戻る' }).click()
  await s5.getByRole('textbox', { name: /^名前/ }).fill('ミルク')
  await s5.getByRole('button', { name: '次へ' }).click()
  await s5.waitForTimeout(3500)
  const p2 = await postBox.inputValue()
  ok(p2.startsWith('【ミルク】') && !p2.split('\n').some((l) => CLOSINGS.map((f) => f('ミント')).includes(l)) && p2.split('\n').some((l) => CLOSINGS.map((f) => f('ミルク')).includes(l)), `書いている間に名前を変えたら、頭の【名前】と最後の決まった文は今の名前（${JSON.stringify(p2.slice(0, 60))}）`)
  ok(await s5.getByText('名前か「いいところ」が変わりました。もう一度確かめてください。').isVisible(), '書いている間に名前を変えたら、本文は確かめ直してもらう')
  // 本文が届いたあとに［消す］などで手で直した投稿文でも、名前を変えたら頭と決まった文は今の名前にする
  await s5.getByRole('button', { name: 'もう一度確かめる' }).first().click()
  await s5.waitForTimeout(800)
  // 確かめ直すと、前の名前（ミント）が残る文に「⚠ 前の名前が残っています」。メモに「ミント」があり、確認役が「ある」と答えても（11/7 作者の決定）
  ok((await s5.locator('[data-old-name]').count()) === 1 && (await s5.locator('.story-line[data-flag="1"]', { hasText: 'ミントはよく食べる子です' }).count()) === 1 && (await s5.locator('.story-line[data-flag="1"]').count()) === 1, '名前を変えて確かめ直すと、前の名前が残る文だけに「⚠ 前の名前が残っています」（メモに前の名前があっても）')
  ok(await s5.getByRole('button', { name: '動画を作る' }).isDisabled(), '前の名前が残る文を片づけるまで、［動画を作る］は押せない')
  await s5.screenshot({ path: join(outDir, '17g_前の名前が残っています.png'), fullPage: true })
  await postBox.fill((await postBox.inputValue()).replace('（仮の本文）夜はよく眠ります。', ''))
  await s5.getByRole('button', { name: '戻る' }).click()
  await s5.getByRole('textbox', { name: /^名前/ }).fill('ハナ')
  await s5.evaluate(() => (window.__confirmAnswer = 'no')) // 「入力の内容で作り直しますか？」に［直した文のまま］
  await s5.getByRole('button', { name: '次へ' }).click()
  await s5.waitForTimeout(800)
  const p3 = await postBox.inputValue()
  ok(p3.startsWith('【ハナ】') && p3.split('\n').some((l) => CLOSINGS.map((f) => f('ハナ')).includes(l)) && !p3.includes('夜はよく眠ります') && p3.includes('（仮の本文）ミントはよく食べる子です。'), `手で直した投稿文のままでも、頭の【名前】と最後の決まった文は今の名前にし、ほかの行は変えない（${JSON.stringify(p3.slice(0, 60))}）`)
  await ctx5.close()
}

// 回数の上限（#20）：上限のときは、そのことを知らせ、手で入れて最後まで進める。スマホの番号を付けて送る
{
  const ctx4 = await browser.newContext({ ...devices['iPhone 15'] })
  const r = await ctx4.newPage()
  const devs = []
  const lim = (route, error) => {
    devs.push(route.request().headers()['x-device'] ?? '')
    return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error }) })
  }
  await r.route('**/api/read', (route) => lim(route, 'limit-device'))
  await r.route('**/api/post', (route) => lim(route, 'limit-all'))
  await r.goto(url)
  await r.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await r.getByLabel('団体名').fill('テスト保護猫の会')
  await r.getByRole('button', { name: '登録して始める' }).click()
  await r.getByRole('button', { name: '新しい子を紹介' }).click()
  await r.getByLabel('預かりさんからのLINE・メモ').fill('（架空）よく食べます。')
  await r.getByRole('button', { name: 'メッセージから読み取る' }).click()
  await r.getByText('このスマホで今日Claudeを使える回数の上限').waitFor({ timeout: 3000 }).catch(() => {})
  ok(await r.getByText('このスマホで今日Claudeを使える回数の上限になりました。明日の0時（日本時間）すぎから、また使えます。下の項目を手で入れてください。').isVisible(), '読み取り：1台の上限のときは、そう知らせて手で入れてもらう')
  await r.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
  await r.locator('.photo img').first().waitFor()
  await r.getByRole('textbox', { name: /^名前/ }).fill('ミント')
  await r.getByLabel('いいところ').fill('よく食べる')
  await r.getByRole('button', { name: '次へ' }).click()
  await r.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await r.getByText('みんなで使う分').waitFor({ timeout: 3000 }).catch(() => {})
  ok(await r.getByText('今日、Claudeを使える回数の上限になりました（みんなで使う分）。明日の0時（日本時間）すぎから、また使えます。下の投稿文は決まった形のままです。').isVisible(), '本文：全体の上限のときは、そう知らせて決まった形の投稿文のまま')
  ok((await r.locator('.field textarea').last().inputValue()).includes('・よく食べる') && !(await r.getByRole('button', { name: '動画を作る' }).isDisabled()), '上限でも、決まった形の投稿文で動画を作れる')
  ok(devs.length === 2 && devs[0] === devs[1] && /^[A-Za-z0-9-]{8,64}$/.test(devs[0]), `同じスマホの番号を付けて送る（${devs[0]?.slice(0, 8)}…）`)
  // 根拠の確認だけ上限になったとき（本文は書けた）：知らせて、本文を外せば動画を作れる
  await r.unroute('**/api/post')
  await r.route('**/api/post', (route) => {
    const body = '（仮の本文）よく食べます。'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { body, parts: [{ text: body, cites: [{ doc: 0, start: 0, end: 1, text: 'よく食べます。' }] }], memoChunks: ['（架空）よく食べます。'], factChunks: ['名前：ミント', 'いいところ：よく食べる'] } }) })
  })
  await r.route('**/api/check', (route) => lim(route, 'limit-device'))
  await r.getByRole('button', { name: '物語の本文を書いてもらう' }).click()
  await r.locator('[data-story-blocked="1"]').waitFor({ timeout: 3000 }).catch(() => {})
  await r.waitForTimeout(500)
  ok((await r.locator('[data-story-blocked="1"]').textContent())?.includes('回数の上限で、本文の根拠を確かめられません') && (await r.getByRole('button', { name: '動画を作る' }).isDisabled()), '根拠の確認が上限のときは、そう知らせ、確かめるまで［動画を作る］は押せない')
  await r.getByRole('button', { name: '本文を外して、決まった形に戻す' }).click()
  await r.waitForTimeout(500)
  ok(!(await r.getByRole('button', { name: '動画を作る' }).isDisabled()), '本文を外すと、決まった形の投稿文で動画を作れる')
  await ctx4.close()
}

await browser.close()
console.log(failures ? `確認NG が ${failures} こ` : 'すべて確認OK')
process.exit(failures ? 1 : 0)
