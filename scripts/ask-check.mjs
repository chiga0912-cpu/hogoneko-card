// 聞き返し（#18。SPEC 2.3）を確かめる。Claudeは呼ばない（窓口の答えを仮のものにすりかえる。費用はかからない）
// 使い方：npm run dev を動かした状態で node scripts/ask-check.mjs [保存先フォルダ] [アドレス]
// メモ・返事はすべて架空のもの
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { askLine, questionOk, fullMemo, replyAddition, REPLY_LABEL } from '../src/lib/ask.ts'

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
ok(replyAddition('（架空）よく遊びます。\n夜は鳴きます') === `${REPLY_LABEL}\n（架空）よく遊びます。\n夜は鳴きます`, '返事は一字も変えずに「（預かりさんの返事）」のあとに足す')
ok(fullMemo({ memo: 'A', memoAdditions: '' }) === 'A' && fullMemo({ memo: 'A', memoAdditions: replyAddition('B') }) === `A\n${REPLY_LABEL}\nB`, '読み取り・投稿文には、元のメモ＋足した返事を使う')

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
const MEMO = '（架空）ミケです。とてもいい子です。よろしくお願いします。'
const panel = (p) => p.locator('[data-ask]')
const readNow = async (p) => {
  await p.getByRole('button', { name: 'メッセージから読み取る' }).click()
  await p.waitForTimeout(600)
}

// 1. 質問が出る → 直す → コピー → 残る（読み込み直しても）→ 返事を足す → 読み取り直す
{
  const { ctx, p, sent } = await setup(Q)
  await p.getByLabel('預かりさんからのメッセージ・メモ').fill(MEMO)
  await readNow(p)
  ok(await panel(p).isVisible(), 'メモが抽象的で質問が出たら、聞き返しの欄が出る')
  const line = p.getByLabel('預かりさんへ送るLINEの文（送る前に、自由に直せます）')
  ok((await line.inputValue()) === 'ミケちゃんの紹介を書いています。ひざに乗ってくることはありますか？ よかったら教えてください。', `LINEの文に、読み取った名前と質問が入る（${await line.inputValue()}）`)
  ok(sent.ask.length === 1 && !sent.ask[0].includes('090'), '読み取りのあとに、聞き返しが要るかを1回だけ聞く')
  await line.fill('ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？')
  await p.getByRole('button', { name: 'LINEの文をコピー' }).click()
  await p.waitForTimeout(200)
  ok((await p.evaluate(() => window.__copied)) === 'ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？', '［LINEの文をコピー］で、直した文をそのままコピーする')
  ok(await p.getByRole('button', { name: 'コピーしました ✓' }).isVisible(), 'コピーしたら「コピーしました ✓」と出る')
  const reply = p.getByLabel('預かりさんの返事（貼るか、書いてください。キーボードのマイクで話してもOK）')
  await reply.fill('（架空）よくひざに乗ってきます')
  await p.screenshot({ path: join(outDir, '4a_聞き返し.png'), fullPage: true })
  // LINEに移って戻った代わりに、読み込み直す
  await p.waitForTimeout(800)
  await p.reload()
  await p.getByLabel('預かりさんからのメッセージ・メモ').waitFor()
  ok(await panel(p).isVisible(), '返事を待つ間も、聞き返しの欄が残る（読み込み直しても消えない）')
  ok((await line.inputValue()) === 'ミケちゃんのことで1つだけ。ひざに乗ってくることはありますか？' && (await reply.inputValue()) === '（架空）よくひざに乗ってきます', '直したLINEの文と、貼りかけの返事も残る')
  const replyText = '（架空）よくひざに乗ってきます。\n夜は  少しさみしがりです🐾'
  await reply.fill(replyText)
  const readsBefore = sent.read.length
  await p.getByRole('button', { name: '返事をメモに足す' }).click()
  await p.waitForTimeout(800)
  ok(!(await panel(p).isVisible()), '返事を足したら、聞き返しの欄は閉じる')
  const added = await p.locator('[data-memo-additions] pre').textContent().catch(() => null)
  ok(added === `${REPLY_LABEL}\n${replyText}`, `返事は書き換えずに、「（預かりさんの返事）」としてメモの最後に足す（${JSON.stringify(added)}）`)
  ok((await p.getByLabel('預かりさんからのメッセージ・メモ').inputValue()) === MEMO, '元のメモの欄は変えない')
  ok(sent.read.length === readsBefore + 1 && sent.read.at(-1).includes(`${REPLY_LABEL}\n（架空）よくひざに乗ってきます。`), '返事を足したら、元のメモ＋返事で読み取り直す')
  ok(sent.ask.length === 1, '返事を足したあとは、もう聞き返さない')
  await p.screenshot({ path: join(outDir, '4b_聞き返し_返事を足した.png'), fullPage: true })
  await p.reload()
  await p.getByLabel('預かりさんからのメッセージ・メモ').waitFor()
  ok((await p.locator('[data-memo-additions] pre').textContent().catch(() => null)) === `${REPLY_LABEL}\n${replyText}`, '足した返事は、入力の途中として残る（読み込み直しても消えない）')
  await readNow(p)
  ok(sent.ask.length === 1 && !(await panel(p).isVisible()), '返事を足したあとで読み取り直しても、聞き返しは出ない')
  await ctx.close()
}

// 2. ［飛ばす］
{
  const { ctx, p, sent } = await setup(Q)
  await p.getByLabel('預かりさんからのメッセージ・メモ').fill(MEMO)
  await readNow(p)
  await p.getByRole('button', { name: '飛ばす' }).click()
  ok(!(await panel(p).isVisible()), '［飛ばす］で、聞き返しの欄が閉じる')
  await readNow(p)
  ok(sent.ask.length === 1 && !(await panel(p).isVisible()), '飛ばしたあと、同じメモで読み取り直しても、もう聞かない')
  await p.waitForTimeout(800)
  await p.reload()
  await p.getByLabel('預かりさんからのメッセージ・メモ').waitFor()
  ok(!(await panel(p).isVisible()), '飛ばしたことも残る（読み込み直しても出ない）')
  // メモを変えたら、新しいメモとして聞く
  await p.getByLabel('預かりさんからのメッセージ・メモ').fill(MEMO + '（架空）かわいいです。')
  await readNow(p)
  ok(sent.ask.length === 2 && (await panel(p).isVisible()), 'メモを変えたら、新しいメモとしてもう一度考える')
  // 新しく始めたら、聞き返しの下書きも消える
  await p.getByRole('button', { name: '戻る' }).click()
  await p.getByRole('button', { name: '新しい子を紹介' }).click()
  await p.getByRole('button', { name: '消して新しく始める' }).click({ timeout: 3000 }).catch(() => {})
  await p.getByLabel('預かりさんからのメッセージ・メモ').waitFor()
  ok((await p.evaluate(() => localStorage.getItem('hogoneko-ask'))) === null && !(await panel(p).isVisible()), '入力の途中を消して新しく始めたら、聞き返しの下書きも消える')
  await ctx.close()
}

// 3. 質問を出さないとき（要らない・メモにない事実が入った・失敗した）
for (const [label, ans] of [
  ['要らない（メモが具体的）', { question: null, skipped: 'not-needed' }],
  ['質問にメモにない事実が入った', { question: null, skipped: 'unsupported' }],
  ['窓口が失敗した', 'fail'],
]) {
  const { ctx, p } = await setup(ans)
  await p.getByLabel('預かりさんからのメッセージ・メモ').fill(MEMO)
  await readNow(p)
  ok(!(await panel(p).isVisible()) && (await p.getByLabel('名前').inputValue()) === 'ミケ', `${label}ときは、聞き返しの欄を出さず、読み取りの結果はそのまま入る`)
  await ctx.close()
}

await browser.close()
console.log(failures ? `確認NGが${failures}こあります` : '聞き返しの確認：全部OK')
process.exit(failures ? 1 : 0)
