// 根拠の確認の練習（#17）：練習用の架空のメモと、わざとメモにない言葉を混ぜた文で「見つけられるか」を見る。測定用の20件とは別
// 使い方：手元で npx wrangler pages dev dist --port 8788 --binding CLAUDE_ENABLED=1 を動かしてから node scripts/check-practice.mjs
// Claude API を使う（費用がかかる。Opus 5.5 で1件 約3〜5円の見込み）
const api = process.env.API ?? 'http://localhost:8788/api/check'
const times = []
const PRICE = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] }

// expect：true＝根拠あり、false＝メモにない（印が付くべき）
const CASES = [
  {
    id: 'くるみ',
    memo: '（練習）くるみは人懐っこいけど、抱っこは苦手です。なでると喉を鳴らします。窓辺で外を見るのが日課です。',
    facts: { name: 'くるみ', goodPoints: ['人懐っこい', 'なでると喉を鳴らす'] },
    sentences: [
      ['くるみは人懐っこいけれど、抱っこは苦手です。', true],
      ['なでると喉を鳴らしてくれるんですよ😊', true],
      ['抱っこが大好きなんです！', false],
      ['窓辺で外を見るのが日課みたいです。', false],
      ['毎朝、玄関までお迎えに来てくれます。', false],
      ['くるみは誰にでも抱っこさせてくれます。', false],
    ],
  },
  {
    id: 'ミント',
    memo: ['ミントちゃんの近況です！最近ごはんをよく食べるようになりました', 'ワクチンのことは代表に聞いてみます。あ、こら、そこ乗らないの！', 'トイレも上手です', 'ただ夜はちょっと鳴きます', '', '爪切りはまだ苦手です'].join('\n'),
    facts: { name: 'ミント', goodPoints: ['ごはんをよく食べる', 'トイレが上手'] },
    sentences: [
      ['ミントは最近、ごはんをよく食べるようになりました！', true],
      ['トイレも上手なんですよ😊', true],
      ['ただ、夜はちょっと鳴きます💦', true],
      ['ワクチンも済んでいて安心です。', false],
      ['さみしがりやなので、夜はちょっと鳴きます。', false],
      ['ミントは夜鳴きをしません。', false],
    ],
  },
  {
    id: 'ルナ',
    memo: '（練習）ルナは知らない人が来ると隠れます。家族には甘えてきます。来月避妊手術の予定。',
    facts: { name: 'ルナ', goodPoints: ['家族には甘えてくる'] },
    sentences: [
      ['ルナは知らない人が来ると隠れてしまいます💦', true],
      ['でも、家族には甘えてきます😊', true],
      ['とってもかわいい甘えん坊さんです♪', false],
      ['ルナは誰にでも甘えてきます。', false],
      ['ルナは知らない人が来ると、隠れちゃうんです💦', true],
    ],
  },
]

let cost = 0
let right = 0
let total = 0
const missed = []
const wrongFlag = []
for (const c of CASES) {
  const t0 = Date.now()
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memo: c.memo, facts: c.facts, sentences: c.sentences.map((s) => s[0]) }),
  })
  const body = await res.json().catch(() => ({}))
  const wall = Date.now() - t0
  times.push(wall)
  const p = PRICE[body.served ?? body.model] ?? PRICE['claude-opus-5-5']
  const yen = body.usage ? (body.usage.input * p[0] + body.usage.output * p[1]) / 1e6 : 0
  cost += yen
  console.log(`\n■ ${c.id}（${wall}ms・${body.served ?? body.model ?? '?'}・入力${body.usage?.input ?? '?'}／出力${body.usage?.output ?? '?'}・約$${yen.toFixed(4)}）`)
  if (!body.results) {
    console.log(`  失敗：${JSON.stringify(body)}`)
    continue
  }
  c.sentences.forEach(([s, expect], i) => {
    const v = body.results[i]
    total++
    const good = v.ok === expect
    if (good) right++
    else (expect ? wrongFlag : missed).push(`${c.id}「${s}」`)
    const where = v.cites.map((q) => `${q.doc === 0 ? 'メモ' : '項目'}「${q.text}」`).join(' ')
    console.log(`  ${good ? '○' : '×'} ${v.ok ? 'ある' : '⚠ない'}（正しくは${expect ? 'ある' : 'ない'}）「${s}」${v.ok ? ' ← ' + where : '：' + v.reason}`)
  })
}
console.log(`\n合っていた：${right}/${total}。見落とし（メモにないのに「ある」）：${missed.length}。まちがった印（メモにあるのに「ない」）：${wrongFlag.length}`)
if (missed.length) console.log(`  見落とし：${missed.join('／')}`)
if (wrongFlag.length) console.log(`  まちがった印：${wrongFlag.join('／')}`)
console.log(`時間（1件）：${times.join('／')}ms`)
console.log(`この回の費用の目安：約$${cost.toFixed(4)}`)
