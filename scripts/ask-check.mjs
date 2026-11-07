// 聞き返し（#18。SPEC 2.3）を確かめる。Claudeは呼ばない（窓口の答えを仮のものにすりかえる。費用はかからない）
// 使い方：npm run dev を動かした状態で node scripts/ask-check.mjs [保存先フォルダ] [アドレス]
// メモ・返事はすべて架空のもの
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { askLine, questionOk, askedLine, noteAsked, alreadyAsked, ASKED_LABEL } from '../src/lib/ask.ts'
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
ok(askedLine('ミケちゃんの紹介を書いています。ひざに乗ってくることはありますか？ よかったら教えてください。') === `${ASKED_LABEL}ひざに乗ってくることはありますか？`, '「聞いたこと」は、LINEの文から初めのあいさつを外した質問を1行で（11/7 作者の決定）')
ok(askedLine('ミケちゃんのことで1つだけ。\nひざに乗ってくることはありますか？') === `${ASKED_LABEL}ミケちゃんのことで1つだけ。 ひざに乗ってくることはありますか？`, 'LINEの文を直していたら、直した文を1行にして足す')
ok(noteAsked('（架空）いい子です。\n\n', `${ASKED_LABEL}Q？`) === `（架空）いい子です。\n${ASKED_LABEL}Q？`, 'メモの欄の最後に1行足す')
ok(noteAsked(`A\n${ASKED_LABEL}Q？`, `${ASKED_LABEL}Q？`) === `A\n${ASKED_LABEL}Q？`, '同じ行は二重に足さない')
ok(noteAsked(`A\n${ASKED_LABEL}Q？\nはい`, `${ASKED_LABEL}R？`, `${ASKED_LABEL}Q？`) === `A\n${ASKED_LABEL}R？\nはい`, '直してコピーし直したら、前に足した行を置きかえる')
ok(alreadyAsked(`A\n${ASKED_LABEL}Q？`) && !alreadyAsked('A'), '「聞いたこと」の行があれば、もう聞いたとみなす')
ok(alreadyAsked('A\n（預かりさんへの質問）\nQ？\n（預かりさんの返事）\nはい'), '朝の版で質問と返事を足した子も、もう聞いたとみなす（見直しの軽い3）')
{
  const hist = `2026/11/07(土)\n10:00\t預かりA\t（架空）いい子です\n${ASKED_LABEL}ひざに乗りますか？\nいいえ`
  ok(cleanLine(hist).text.includes(`${ASKED_LABEL}ひざに乗りますか？`), 'LINEの履歴の形のメモでも、「聞いたこと」の行は外さない')
}
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
  const ASKED = `${ASKED_LABEL}ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？`
  ok((await memoBox.inputValue()) === `${MEMO}\n${ASKED}`, `［LINEの文をコピー］で、メモの欄の最後に「聞いたこと」を1行足す（${JSON.stringify(await memoBox.inputValue())}）`)
  ok(await p.getByText('返事が来たら、LINE・メモの欄の最後に貼って、もう一度［メッセージから読み取る］を押してください').isVisible(), '返事の貼り方を短く出す')
  await p.getByRole('button', { name: /LINEの文をコピー|コピーしました/ }).click()
  await p.waitForTimeout(200)
  ok((await memoBox.inputValue()) === `${MEMO}\n${ASKED}`, 'もう一度コピーしても、二重には足さない')
  await p.screenshot({ path: join(outDir, '4a_聞き返し.png'), fullPage: true })
  // LINEに移って戻った代わりに、読み込み直す
  await p.waitForTimeout(800)
  await p.reload()
  await memoBox.waitFor()
  ok(await panel(p).isVisible(), '返事を待つ間も、聞き返しの欄が残る（読み込み直しても消えない）')
  ok((await line.inputValue()) === 'ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？' && (await memoBox.inputValue()) === `${MEMO}\n${ASKED}`, '直したLINEの文と、足した「聞いたこと」も残る')
  // 返事をメモの欄の最後に貼って、読み取り直す
  const replyText = '（架空）よくひざに乗ってきます。\n夜は  少しさみしがりです🐾 電話は 090-0000-0000 です'
  await memoBox.fill(`${MEMO}\n${ASKED}\n${replyText}`)
  ok(!(await panel(p).isVisible()), '返事を貼ってメモが変わったら、聞き返しの欄は閉じる')
  const readsBefore = sent.read.length
  await readNow(p)
  ok(sent.read.length === readsBefore + 1 && sent.read.at(-1).includes(`${ASKED_LABEL}ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？\n（架空）よくひざに乗ってきます。`), '読み取り直すと、「聞いたこと」と返事を含めたメモで読み取る')
  ok(!sent.read.at(-1).includes('090-0000-0000'), '読み取り直すときも、返事の中の電話番号を伏せて送る（見直しの5）')
  ok(sent.ask.length === 1 && !(await panel(p).isVisible()), '「聞いたこと」の行があれば、もう聞き返さない')
  await p.screenshot({ path: join(outDir, '4b_聞き返し_返事を貼った.png'), fullPage: true })
  // 「聞いたこと」の行は人が消せる。消して読み取ると、新しいメモとしてもう一度考える
  await memoBox.fill(MEMO + '（架空）よくひざに乗ってきます。')
  await readNow(p)
  ok(sent.ask.length === 2, '「聞いたこと」の行を消して読み取ると、もう一度聞き返しを考える')
  await ctx.close()
}

// 2. ［飛ばす］
{
  const { ctx, p, sent } = await setup(Q)
  await p.getByLabel('預かりさんからのLINE・メモ').fill(MEMO)
  await readNow(p)
  await p.getByRole('button', { name: '飛ばす' }).click()
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
  ok(sent.ask.length === 2 && (await panel(p).isVisible()), 'メモを変えたら、新しいメモとしてもう一度考える')
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
  ok((await p.getByLabel('預かりさんからのLINE・メモ').inputValue()).endsWith(`${ASKED_LABEL}ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？`), '変換を確定する前の文字のままでも、メモには見えていた文で「聞いたこと」を足す')
  await ctx.close()
}

await browser.close()
console.log(failures ? `確認NGが${failures}こあります` : '聞き返し・カードの言葉の案の確認：全部OK')
process.exit(failures ? 1 : 0)
