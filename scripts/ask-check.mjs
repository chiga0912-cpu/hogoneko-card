// 聞き返し（#18。SPEC 2.3）を確かめる。Claudeは呼ばない（窓口の答えを仮のものにすりかえる。費用はかからない）
// 使い方：npm run dev を動かした状態で node scripts/ask-check.mjs [保存先フォルダ] [アドレス]
// メモ・返事はすべて架空のもの
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { askLine, questionOk, alreadyAsked, ASKED_LABEL } from '../src/lib/ask.ts'
import { cleanLine } from '../src/lib/lineText.ts'
import { cardSwaps, cardWordLines, addSwap, removeSwap } from '../src/lib/words.ts'

const outDir = process.argv[2] ?? 'screenshots'
const url = process.argv[3] ?? 'http://localhost:5173'
mkdirSync(outDir, { recursive: true })
let failures = 0
const ok = (c, s) => {
  console.log((c ? '確認OK: ' : '確認NG: ') + s)
  if (!c) failures++
}

// ── プログラムの部分 ──
ok(askLine('ミケ', 'ひざに乗ってくることはありますか？') === 'ミケちゃんの紹介を書いています。ひざに乗ってくることはありますか？ よかったら教えてください。', 'LINEの文は SPEC 2.3 のとおり（名前あり）')
ok(askLine(' ', 'ひざに乗ってくることはありますか？') === '紹介を書いています。ひざに乗ってくることはありますか？ よかったら教えてください。', '名前がまだないときは「紹介を書いています。」から')
ok(questionOk('ひざに乗ってくることはありますか？') && questionOk('好きなおもちゃはありますか?'), '質問1つ・「？」で終わる形は通す')
ok(!questionOk('ひざに乗りますか？おもちゃは好きですか？') && !questionOk('ひざに乗りますか？\nよろしく') && !questionOk('ひざに乗ります。') && !questionOk('あ'.repeat(70) + '？'), '質問が2つ・改行あり・「？」なし・長すぎるものは通さない')
ok(alreadyAsked(`A\n${ASKED_LABEL}Q？`) && !alreadyAsked('A'), '試し用の前の版で「聞いたこと」の行を足した子は、もう聞いたとみなす')
ok(alreadyAsked('A\n（預かりさんへの質問）\nQ？\n（預かりさんの返事）\nはい'), '朝の版で質問と返事を足した子も、もう聞いたとみなす（見直しの軽い3）')
{
  const gp = ['短い行', '（架空）とても長い元の行です']
  const cl = addSwap([], '（架空）とても長い元の行です', '長い元の行')
  ok(JSON.stringify(cardWordLines(gp, cl)) === JSON.stringify(['短い行', '長い元の行']) && JSON.stringify(gp) === JSON.stringify(['短い行', '（架空）とても長い元の行です']), '選んだ案は、カードの言葉の候補だけを変え、「いいところ」の行は変えない')
  ok(cardSwaps(cl, ['短い行', '（架空）手で直した行']).length === 0 && JSON.stringify(cardWordLines(['（架空）手で直した行'], cl)) === JSON.stringify(['（架空）手で直した行']), '元の行を手で直したら、その案は使わない（別の行に付かない）')
  ok(removeSwap(cl, '（架空）とても長い元の行です').length === 0 && addSwap(cl, '（架空）とても長い元の行です', '別の案').length === 1, '［元に戻す］で外せる。同じ行に選び直したら、前の案と入れかわる')
}

// ── 画面の部分（窓口の答えをすりかえる）──
const browser = await chromium.launch()
const READ = (name) => ({
  result: { name: name ? { value: name, source: `${name}です。` } : null, sex: null, age: null, vaccine: null, neuter: null, virusTest: null, goodPoints: [], carerWords: null },
  dropped: [],
})
const setup = async (askAnswer) => {
  const ctx = await browser.newContext({ ...devices['iPhone 15'] })
  // コピーした文を残す（本当のクリップボードの代わり）
  await ctx.addInitScript(() => {
    window.__copied = null
    try {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => void (window.__copied = t) }, configurable: true })
    } catch {
      // そのまま
    }
  })
  const p = await ctx.newPage()
  const sent = { read: [], ask: [] }
  await p.route('**/api/read', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    sent.read.push(body.memo)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(READ('ミケ')) })
  })
  await p.route('**/api/ask', async (route) => {
    sent.ask.push(JSON.parse(route.request().postData() ?? '{}').memo)
    const a = typeof askAnswer === 'function' ? askAnswer() : askAnswer
    if (a === 'fail') return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'api' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) })
  })
  await p.goto(url)
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p.getByLabel('団体名').fill('テスト保護猫の会')
  await p.getByRole('button', { name: '登録して始める' }).click()
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  return { ctx, p, sent }
}
const Q = { question: 'ひざに乗ってくることはありますか？', skipped: null }
const MEMO = '（架空）ミケです。とてもいい子です。よろしくお願いします。連絡は 090-0000-0000 か test@example.com へ。'
const panel = (p) => p.locator('[data-ask]')
const readNow = async (p) => {
  await p.getByRole('button', { name: 'メッセージから読み取る' }).click()
  await p.waitForTimeout(600)
}

// 1. 質問が出る → 直す → コピー → 残る（読み込み直しても）→ 返事を足す → 読み取り直す
{
  const { ctx, p, sent } = await setup(Q)
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO)
  await readNow(p)
  ok(await panel(p).isVisible(), 'メモが抽象的で質問が出たら、聞き返しの欄が出る')
  ok((await panel(p).getByText(/［LINEの文をコピー］を押すと|返事が来たら/).count()) === 0, 'コピーの前は、説明も案内も出さない（11/7 夕方 作者の決定）')
  const line = p.getByLabel('預かりさんへ送るLINEの文（送る前に、自由に直せます）')
  ok((await line.inputValue()) === 'ミケちゃんの紹介を書いています。ひざに乗ってくることはありますか？ よかったら教えてください。', `LINEの文に、読み取った名前と質問が入る（${await line.inputValue()}）`)
  ok(sent.ask.length === 1, '読み取りのあとに、聞き返しが要るかを1回だけ聞く')
  ok(!sent.ask[0].includes('090-0000-0000') && !sent.ask[0].includes('test@example.com') && sent.ask[0].includes('［電話番号］'), '聞き返しの窓口にも、電話番号・メールを伏せて送る（見直しの5）')
  await line.fill('ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？')
  await p.getByRole('button', { name: 'LINEの文をコピー' }).click()
  await p.waitForTimeout(200)
  ok((await p.evaluate(() => window.__copied)) === 'ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？', '［LINEの文をコピー］で、直した文をそのままコピーする')
  ok(await p.getByRole('button', { name: 'コピーしました ✓' }).isVisible(), 'コピーしたら「コピーしました ✓」と出る')
  await line.fill('ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？ ')
  ok(await p.getByRole('button', { name: 'LINEの文をコピー' }).isVisible(), 'コピーしたあとでLINEの文を直したら、ボタンは［LINEの文をコピー］に戻る（見直しの8）')
  await line.fill('ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？')
  const memoBox = p.getByLabel('預かりさんからのLINE・メモ')
  ok((await p.getByLabel(/預かりさんの返事/).count()) === 0 && (await p.getByRole('button', { name: '返事をメモに足す' }).count()) === 0, '返事を貼る専用の欄と［返事をメモに足す］はない（11/7 作者の決定）')
  ok((await memoBox.inputValue()) === MEMO && !(await memoBox.inputValue()).includes(ASKED_LABEL), '［LINEの文をコピー］を押しても、メモの欄には何も足さない（11/7 夕方 作者の決定）')
  ok(await p.getByText('返事が来たら、LINE・メモの欄に貼って、もう一度［メッセージから読み取る］を押してください。').isVisible(), 'コピーの後に、返事の貼り方の案内を出す（11/7 夕方 作者の決定）')
  await p.screenshot({ path: join(outDir, '4a_聞き返し.png'), fullPage: true })
  // LINEに移って戻った代わりに、読み込み直す
  await p.waitForTimeout(800)
  await p.reload()
  await memoBox.waitFor()
  ok(await panel(p).isVisible(), '返事を待つ間も、聞き返しの欄が残る（読み込み直しても消えない）')
  ok((await line.inputValue()) === 'ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？' && (await p.getByText('返事が来たら、LINE・メモの欄に貼って').isVisible()) && (await memoBox.inputValue()) === MEMO, '直したLINEの文と、コピーの後の案内も残る。メモはそのまま')
  // 返事をメモの欄に貼って、読み取り直す
  const replyText = '（架空）毎朝、窓辺で外を見ています。\n夜は  少しさみしがりです🐾 電話は 090-0000-0000 です'
  await memoBox.fill(`${MEMO}\n${replyText}`)
  ok(!(await panel(p).isVisible()), '返事を貼ってメモが変わったら、聞き返しの欄は閉じる')
  const readsBefore = sent.read.length
  await readNow(p)
  ok(sent.read.length === readsBefore + 1 && sent.read.at(-1).includes('（架空）毎朝、窓辺で外を見ています。'), '読み取り直すと、返事を含めたメモで読み取る')
  ok(!sent.read.at(-1).includes('090-0000-0000'), '読み取り直すときも、返事の中の電話番号を伏せて送る（見直しの5）')
  ok(sent.ask.length === 1 && !(await panel(p).isVisible()), '1匹に1回：この子にはもう質問を出したので、読み取り直しても聞き返さない')
  await p.screenshot({ path: join(outDir, '4b_聞き返し_返事を貼った.png'), fullPage: true })
  // メモを書きかえても、同じ子には聞かない
  await memoBox.fill(MEMO)
  await readNow(p)
  ok(sent.ask.length === 1, '1匹に1回：メモを書きかえても、同じ子には二度聞かない')
  // 覚えたものが消えたら、もう一度聞くことになる（作者の決定でかまわない）
  await p.evaluate(() => localStorage.removeItem('hogoneko-asked-cats'))
  await memoBox.fill(MEMO + '（架空）かわいいです。')
  await readNow(p)
  ok(sent.ask.length === 2, '聞いた子を覚えたものが消えたら、もう一度考える（作者の決定でかまわない）')
  await ctx.close()
}

// 2. ［飛ばす］
{
  const { ctx, p, sent } = await setup(Q)
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO)
  await readNow(p)
  await p.getByRole('button', { name: '飛ばす' }).click()
  await p.waitForTimeout(200) // ［飛ばす］は、入力を確定してから1拍おいて閉じる
  ok(!(await panel(p).isVisible()), '［飛ばす］で、聞き返しの欄が閉じる')
  await readNow(p)
  ok(sent.ask.length === 1 && !(await panel(p).isVisible()), '飛ばしたあと、同じメモで読み取り直しても、もう聞かない')
  await p.waitForTimeout(800)
  await p.reload()
  await p.getByLabel('預かりさんからのLINE・メモ').waitFor()
  ok(!(await panel(p).isVisible()), '飛ばしたことも残る（読み込み直しても出ない）')
  // メモを変えたら、新しいメモとして聞く
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO + '（架空）かわいいです。')
  await readNow(p)
  ok(sent.ask.length === 1 && !(await panel(p).isVisible()), '1匹に1回：質問を出して［飛ばす］を押した子は、メモを変えても、もう聞かない')
  // 新しく始めたら、聞き返しの下書きも消える
  await p.getByRole('button', { name: '戻る' }).click()
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  await p.getByRole('button', { name: '消して新しく始める' }).click({ timeout: 3000 }).catch(() => {})
  await p.getByLabel('預かりさんからのLINE・メモ').waitFor()
  ok((await p.evaluate(() => localStorage.getItem('hogoneko-ask'))) === null && !(await panel(p).isVisible()), '入力の途中を消して新しく始めたら、聞き返しの下書きも消える')
  await ctx.close()
}

// 2b. 一時的な失敗（AIの返事が崩れた）なら、次に読み取ったときにもう一度考える（見直しの2）
{
  let n = 0
  const { ctx, p, sent } = await setup(() => (++n === 1 ? { question: null, skipped: 'ask-failed' } : Q))
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO)
  await readNow(p)
  ok(!(await panel(p).isVisible()), '質問を作るのに失敗したときは、欄を出さない')
  await readNow(p)
  ok(sent.ask.length === 2 && (await panel(p).isVisible()), '一時的な失敗のあとは、次に読み取ったときにもう一度考える')
  await ctx.close()
}

// 3. 質問を出さないとき（要らない・メモにない事実が入った・失敗した）
for (const [label, ans] of [
  ['要らない（メモが具体的）', { question: null, skipped: 'not-needed' }],
  ['質問にメモにない事実が入った', { question: null, skipped: 'unsupported' }],
  ['窓口が失敗した', 'fail'],
]) {
  const { ctx, p } = await setup(ans)
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO)
  await readNow(p)
  ok(!(await panel(p).isVisible()) && (await p.getByRole('textbox', { name: /^名前/ }).inputValue()) === 'ミケ', `${label}ときは、聞き返しの欄を出さず、読み取りの結果はそのまま入る`)
  await ctx.close()
}

// ── #19 カードの言葉の案（窓口の答えをすりかえる）──
{
  const LONG = '（架空）人が帰ってくると玄関までお迎えに来て、足元にすりすりしてくれて、そのあとひざに乗ってくる'
  const { ctx, p } = await setup(Q)
  const sentWords = []
  const sentChecks = []
  await p.route('**/api/words', async (route) => {
    sentWords.push(JSON.parse(route.request().postData() ?? '{}'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ line: LONG, proposals: ['玄関までお迎え', '毎日玄関でお出迎え'] }] }) })
  })
  await p.route('**/api/check', async (route) => {
    const b = JSON.parse(route.request().postData() ?? '{}')
    sentChecks.push(b)
    // 2つ目の案は「毎日」がメモにないので、根拠なしにする
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: b.sentences.map((t, i) => ({ i, ok: !t.includes('毎日'), cites: [], reason: t.includes('毎日') ? '毎日' : '' })) }) })
  })
  const dummy = { name: 'p.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#8fa9a3"/></svg>') }
  await p.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
  await p.locator('.photo img').first().waitFor()
  await p.getByRole('textbox', { name: /^名前/ }).fill('ポン')
  await p.getByLabel('預かりさんからのLINE・メモ').fill('（架空）ポンは人が帰ってくると玄関までお迎えに来て、足元にすりすりしてくれて、そのあとひざに乗ってきます。連絡は 090-0000-0000')
  await p.getByLabel('いいところ').fill(LONG)
  await p.getByRole('button', { name: '次へ' }).click()
  await p.locator('.card-canvas[data-drawn="1"]').waitFor({ timeout: 8000 })
  const ideas = p.locator('[data-word-ideas]')
  ok(await ideas.isVisible(), '長くて猫カードに入らない行があると、短い言葉の案の欄が出る')
  ok(sentWords.length === 0, '押すまでは、Claudeに案を作らせない')
  await p.getByRole('button', { name: '短い言葉の案を出す' }).click()
  await p.getByRole('button', { name: '「玄関までお迎え」を使う' }).waitFor({ timeout: 5000 }).catch(() => {})
  ok(sentWords.length === 1 && JSON.stringify(sentWords[0].lines) === JSON.stringify([LONG]) && !sentWords[0].memo.includes('090-0000-0000'), '入らなかった行だけを、伏せたメモと一緒に送る')
  ok(sentChecks.length === 1 && JSON.stringify(sentChecks[0].sentences) === JSON.stringify(['玄関までお迎え', '毎日玄関でお出迎え']), '案は、本文と同じ根拠の確認にかける')
  ok(await p.getByRole('button', { name: '「玄関までお迎え」を使う' }).isVisible(), '根拠の確認を通った案は出る')
  ok((await p.getByRole('button', { name: '「毎日玄関でお出迎え」を使う' }).count()) === 0, 'メモにない言葉が入った案は出さない')
  ok((await p.locator('.card-canvas').getAttribute('data-word')) === '', '選ぶまでは、カードも「いいところ」も変えない')
  await p.screenshot({ path: join(outDir, '4c_カードの言葉の案.png'), fullPage: true })
  await p.getByRole('button', { name: '「玄関までお迎え」を使う' }).click()
  await p.waitForTimeout(800)
  ok((await p.locator('.card-canvas').getAttribute('data-word')) === '玄関までお迎え', '選んだ案が、猫カードの言葉になる')
  ok(await ideas.getByText('「玄関までお迎え」にしました').isVisible(), '猫カードの言葉だけを案にしたことを知らせる')
  // 名簿の「いいところ」は書き換えない。画面を出て戻っても、案のまま・［元に戻す］が使える（11/7 作者の決定）
  await p.getByRole('button', { name: '戻る' }).click()
  ok((await p.getByLabel('いいところ').inputValue()) === LONG, '案を選んでも、「いいところ」の行は書き換えない')
  await p.getByRole('button', { name: '次へ' }).click()
  await p.locator('.card-canvas[data-drawn="1"]').waitFor({ timeout: 8000 })
  await p.waitForTimeout(500)
  ok((await p.locator('.card-canvas').getAttribute('data-word')) === '玄関までお迎え' && (await p.getByRole('button', { name: '元に戻す' }).isVisible()), '画面を出て戻っても、猫カードは案のまま・［元に戻す］が使える')
  await p.getByRole('button', { name: '元に戻す' }).click()
  await p.waitForTimeout(800)
  ok((await p.locator('.card-canvas').getAttribute('data-word')) === '', '［元に戻す］で、元の行に戻る')
  await p.getByRole('button', { name: '戻る' }).click()
  ok((await p.getByLabel('いいところ').inputValue()) === LONG, '元に戻したあとは、「いいところ」も元の行のまま')
  await ctx.close()
}

// 案を出せないとき（確かめられない・全部メモにない）
{
  const LONG = '（架空）人が帰ってくると玄関までお迎えに来て、足元にすりすりしてくれて、そのあとひざに乗ってくる'
  const { ctx, p } = await setup(Q)
  await p.route('**/api/words', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ line: LONG, proposals: ['玄関までお迎え'] }] }) }))
  await p.route('**/api/check', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'api' }) }))
  const dummy = { name: 'p.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#8fa9a3"/></svg>') }
  await p.locator('input[type=file][accept="image/*"]').setInputFiles(dummy)
  await p.locator('.photo img').first().waitFor()
  await p.getByRole('textbox', { name: /^名前/ }).fill('ポン')
  await p.getByLabel('いいところ').fill(LONG)
  await p.getByRole('button', { name: '次へ' }).click()
  await p.locator('.card-canvas[data-drawn="1"]').waitFor({ timeout: 8000 })
  await p.getByRole('button', { name: '短い言葉の案を出す' }).click()
  await p.getByText('案の根拠を確かめられなかったので').waitFor({ timeout: 5000 }).catch(() => {})
  ok((await p.getByText('案の根拠を確かめられなかったので、案は出しません').isVisible()) && (await p.getByRole('button', { name: /を使う/ }).count()) === 0, '案の根拠を確かめられないときは、案を出さない')
  await ctx.close()
}

// 5. 読み取りは「いいところ」「ひとこと」を入れない・書き換えない（人が書く欄。11/7 作者の決定。SPEC 2.2）
{
  const { ctx, p } = await setup({ question: null, skipped: 'not-needed' })
  await p.route('**/api/read', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: { ...READ('ミケ').result, sex: { value: 'メス', source: 'メスです。' }, goodPoints: [{ text: 'よく食べる', source: 'よく食べます。' }], carerWords: '毎日癒されています。' },
        dropped: ['いいところ「ひざが好き」', 'ひとこと', '年齢'],
      }),
    }),
  )
  await p.getByLabel('預かりさんからのLINE・メモ').fill('（架空）ミケです。メスです。よく食べます。毎日癒されています。')
  await readNow(p)
  ok((await p.getByRole('textbox', { name: /^名前/ }).inputValue()) === 'ミケ', '読み取りで、名前は今までどおり入る')
  ok((await p.getByLabel('いいところ').inputValue()) === '' && (await p.getByLabel(/見る人へのひとこと/).inputValue()) === '', '読み取りの答えに「いいところ」「ひとこと」があっても、欄には入れない')
  const report = (await p.locator('.notice, .muted').allTextContents()).join(' ')
  ok(report.includes('性別') && !report.includes('いいところ') && !report.includes('ひとこと') && report.includes('年齢'), `読み取りの知らせに「いいところ」「ひとこと」を出さない（${report.slice(0, 120)}）`)
  ok((await p.getByText('スタッフさんが書く欄です。1行に1つ、短い言葉にすると、動画の猫カードに出ます。').isVisible()) && (await p.getByText('ここから紹介文を作り、名前や年齢などの欄も埋めます。何通かあれば、続けて貼ってください。').isVisible()), '「いいところ」とLINE・メモの欄の案内（11/7 作者の決定）')
  // 先に書いた「いいところ」「ひとこと」は、読み取り直しても書き換えない
  await p.getByLabel('いいところ').fill('スタッフが書いた言葉')
  await p.getByLabel(/見る人へのひとこと/).fill('スタッフのひとこと')
  await readNow(p)
  ok((await p.getByLabel('いいところ').inputValue()) === 'スタッフが書いた言葉' && (await p.getByLabel(/見る人へのひとこと/).inputValue()) === 'スタッフのひとこと', '人が書いた「いいところ」「ひとこと」は、読み取り直しても変えない')
  await ctx.close()
}

// 5b. 読み取りで、入る項目が1つも見つからなかったときの案内（11/8 作者の決定）
{
  const { ctx, p } = await setup({ question: null, skipped: 'not-needed' })
  await p.route('**/api/read', async (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ...READ('').result, goodPoints: [{ text: 'お迎え', source: 'お迎え' }] }, dropped: [] }) }),
  )
  await p.getByLabel('預かりさんからのLINE・メモ').fill('（架空）毎朝玄関までお迎えに来てくれます。')
  await readNow(p)
  ok(
    await p.getByText('名前・年齢・性別・健康のことは、メモから見つけられませんでした。名前は下の欄に入れ、年齢や健康のことは下のボタンで選んでください。メモの内容は、次の画面で紹介文を書くときに使います。').isVisible(),
    '入る項目が1つも見つからなかったときは、作者が決めた案内を出す',
  )
  ok((await p.getByText('メモから入れられる項目は見つかりませんでした').count()) === 0, '前の案内（メモから入れられる項目は見つかりませんでした）は出さない')
  await p.screenshot({ path: join(outDir, '4c_読み取り_項目なし.png'), fullPage: true })
  await ctx.close()
}
// 見つかったが入れなかったとき（名前が同じ値でもう入っていた・年齢は案だけ）は、「見つけられませんでした」を出さない（見直しの中3）
{
  const { ctx, p } = await setup({ question: null, skipped: 'not-needed' })
  await p.route('**/api/read', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: { ...READ('ソラ').result, age: { kind: 'months', amount: 3, stage: null, source: '生後3ヶ月くらいです' } }, dropped: [] }),
    }),
  )
  await p.getByRole('textbox', { name: /^名前/ }).fill('ソラ')
  await p.getByLabel('預かりさんからのLINE・メモ').fill('（架空）ソラです。生後3ヶ月くらいです。')
  await readNow(p)
  ok((await p.locator('[data-read-none]').count()) === 0 && (await p.getByText(/生まれた年月を .*にしますか/).isVisible()), '名前が同じ値でもう入っていて、年齢は案だけのときは、「見つけられませんでした」を出さず、年齢の案を出す')
  await ctx.close()
}

// 6. 変換を確定する前の文字（欄には見えているが、入力の知らせがまだ届いていない）のまま［LINEの文をコピー］を押しても、見えている文をコピーし、メモに足す（11/7）
{
  const { ctx, p } = await setup(Q)
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO)
  await readNow(p)
  await p.evaluate(() => {
    const t = [...document.querySelectorAll('textarea')].find((x) => x.closest('[data-ask]'))
    t.focus()
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    setValue.call(t, 'ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？')
    t.addEventListener('blur', () => t.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })), { once: true })
  })
  await p.getByRole('button', { name: 'LINEの文をコピー' }).click()
  await p.waitForTimeout(300)
  ok((await p.evaluate(() => window.__copied)) === 'ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？', '変換を確定する前の文字のまま［LINEの文をコピー］を押しても、欄に見えている文をコピーする')
  ok((await p.getByLabel('預かりさんからのLINE・メモ').inputValue()) === MEMO, '変換を確定する前の文字のままコピーしても、メモの欄には何も足さない')
  await ctx.close()
}

// 7. 質問が出ても、［LINEの文をコピー］か［飛ばす］を押す前にメモを直したら、聞いたことにしない（もう一度読み取ったら、また聞く。11/7 夜 作者の決定）
{
  const { ctx, p, sent } = await setup(Q)
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO)
  await readNow(p)
  ok(await panel(p).isVisible(), '質問が出る')
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO + '（架空）元気です。')
  ok(!(await panel(p).isVisible()), 'コピーの前にメモを直したら、質問の欄は閉じる')
  await readNow(p)
  ok(sent.ask.length === 2 && (await panel(p).isVisible()), 'コピーも［飛ばす］も押していなければ、もう一度読み取ったときに、また聞く')
  await ctx.close()
}

// 8. メモが一字一句同じ別の子に、前の子の聞き返しの下書きを出さない（見直しの中2）
{
  const { ctx, p, sent } = await setup(Q)
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO)
  await readNow(p)
  ok(await panel(p).isVisible(), '1匹目で質問が出る')
  // 新しく始めずに、2匹目へ（名簿から別の子を開く代わりに、入力の途中を残したまま、新しい子の id で同じメモを入れる）
  await p.evaluate(() => {
    const raw = localStorage.getItem('hogoneko-ask')
    const a = JSON.parse(raw)
    a.catId = 'another-cat'
    localStorage.setItem('hogoneko-ask', JSON.stringify(a))
  })
  await p.reload()
  await p.getByLabel('預かりさんからのLINE・メモ').waitFor()
  ok(!(await panel(p).isVisible()), '別の子の聞き返しの下書きは、メモが同じでも出さない')
  await readNow(p)
  ok(sent.ask.length === 2 && (await panel(p).isVisible()) && (await p.getByLabel('預かりさんへ送るLINEの文（送る前に、自由に直せます）').inputValue()).startsWith('ミケちゃん'), 'その子で読み取ると、その子のために聞き返しを考える')
  await ctx.close()
}

// 9. 団体の情報の［保存］：変換を確定する前の文字も入れてから保存する（見直しの中3）
{
  const ctx = await browser.newContext({ ...devices['iPhone 15'] })
  const p = await ctx.newPage()
  await p.goto(url)
  await p.getByRole('button', { name: '追加せずに、このまま使う' }).click()
  await p.getByLabel('団体名').fill('テスト保護猫')
  await p.evaluate(() => {
    const t = [...document.querySelectorAll('input')].find((x) => x.value === 'テスト保護猫')
    t.focus()
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    setValue.call(t, 'テスト保護猫の会') // 入力の知らせ（input）は送らない
  })
  await p.getByRole('button', { name: '登録して始める' }).click()
  await p.getByRole('button', { name: '新しい子を紹介' }).waitFor({ timeout: 5000 }).catch(() => {})
  ok(await p.getByText('テスト保護猫の会', { exact: true }).isVisible(), '変換を確定する前の文字のまま［登録して始める］を押しても、欄に見えている団体名で保存する')
  await ctx.close()
}

await browser.close()
console.log(failures ? `確認NGが${failures}こあります` : '聞き返し・カードの言葉の案の確認：全部OK')
process.exit(failures ? 1 : 0)
