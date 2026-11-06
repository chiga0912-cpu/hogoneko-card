// 回数の上限（#20）の確かめ。Claudeにはつながない（費用がかからない）
// 1. 部品だけ：数える場所（KV）のまねで、全体・1台ごと・日付・本文の2回分・数えられないとき
// 2. 手元のサーバー（任意）：API=http://localhost:8795 のとき、使えない仮のキーと小さな上限（全体5・1台3）で、本物の窓口を通して確かめる
//    上限の内側では Claude に断られて 502（api）、上限を超えたら 429。仮のキーなので費用はかからない
import { takeCall, tokyoDay, DEFAULT_DAY_ALL, DEFAULT_DAY_DEVICE } from '../functions/lib/limit.ts'

let failures = 0
const ok = (cond, what) => {
  console.log(`${cond ? '確認OK' : '確認NG'}: ${what}`)
  if (!cond) failures++
}
const kv = () => {
  const m = new Map()
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v, o) => void m.set(k, v) || void (o && m.set('ttl:' + k, o.expirationTtl)) }
}
const req = (dev, ip = '1.2.3.4') => new Request('http://x/api/read', { method: 'POST', headers: { ...(dev ? { 'x-device': dev } : {}), 'cf-connecting-ip': ip } })
const code = async (r) => (r ? (await r.json()).error : 'pass')

// ── 1. 部品だけ ──
ok(tokyoDay(Date.UTC(2026, 10, 6, 14, 59)) === '2026-11-06' && tokyoDay(Date.UTC(2026, 10, 6, 15, 0)) === '2026-11-07', '1日の区切りは日本時間の0時')
ok((await code(await takeCall(req('aaaaaaaa'), {}))) === 'no-limit', '数える場所（LIMITS）がないときは、Claudeを呼ばない')
{
  const k = kv()
  const env = { LIMITS: k, LIMIT_DAY_ALL: '5', LIMIT_DAY_DEVICE: '3' }
  const r = []
  for (let i = 0; i < 4; i++) r.push(await code(await takeCall(req('device-aaaa'), env)))
  ok(r.join(',') === 'pass,pass,pass,limit-device', `1台ごとの上限（3回）を超えると断る（${r.join(',')}）`)
  const r2 = []
  for (let i = 0; i < 3; i++) r2.push(await code(await takeCall(req('device-bbbb'), env)))
  ok(r2.join(',') === 'pass,pass,limit-all', `全体の上限（5回）を超えると、別のスマホでも断る（${r2.join(',')}）`)
  const ttl = [...k.m.entries()].filter(([key]) => key.startsWith('ttl:')).map(([, v]) => v)
  ok(ttl.length > 0 && ttl.every((v) => v === 172800), '回数は2日で消える')
  ok([...k.m.keys()].every((key) => !key.includes('1.2.3.4')), '接続元のアドレスそのものは残さない')
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000
  ok((await code(await takeCall(req('device-aaaa'), env, 1, tomorrow))) === 'pass', '次の日（日本時間）には、また使える')
}
{
  const env = { LIMITS: kv(), LIMIT_DAY_ALL: '5', LIMIT_DAY_DEVICE: '3' }
  await takeCall(req('device-cccc'), env)
  await takeCall(req('device-cccc'), env)
  ok((await code(await takeCall(req('device-cccc'), env, 2))) === 'limit-device', '本文を書く呼び出しは、続く根拠の確認の分（あと2回）が残っていないと断る')
  ok((await code(await takeCall(req('device-cccc'), env, 1))) === 'pass', '根拠の確認（1回分）は、残り1回でも通る')
}
{
  const env = { LIMITS: kv(), LIMIT_DAY_DEVICE: '2' }
  await takeCall(req(null, '5.6.7.8'), env)
  await takeCall(req(null, '5.6.7.8'), env)
  ok((await code(await takeCall(req(null, '5.6.7.8'), env))) === 'limit-device' && (await code(await takeCall(req(null, '9.9.9.9'), env))) === 'pass', '番号がないときは、接続元ごとに数える')
}
{
  const broken = { get: async () => { throw new Error('x') }, put: async () => {} }
  ok((await code(await takeCall(req('device-dddd'), { LIMITS: broken }))) === 'no-limit', '数える場所が読めないときは、Claudeを呼ばない')
  const slow = { m: new Map(), get: async () => '0', put: async () => { throw new Error('429') } }
  ok((await code(await takeCall(req('device-eeee'), { LIMITS: slow }))) === 'pass', '書きこみが混んで失敗しても、読んだ数が上限より下なら通す（少し超えることがある）')
}
ok(DEFAULT_DAY_ALL === 300 && DEFAULT_DAY_DEVICE === 50, `決まっていない数字の仮の値（全体${DEFAULT_DAY_ALL}・1台${DEFAULT_DAY_DEVICE}）`)

// ── 2. 手元のサーバー ──
const api = process.env.API
if (api) {
  const call = async (path, dev, body) => {
    const res = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device': dev }, body: JSON.stringify(body) })
    const b = await res.json().catch(() => ({}))
    return `${res.status}:${b.error}`
  }
  const memo = { memo: '（架空）よく食べます。' }
  ok((await call('/api/read', 'srv-dev-1', {})) === '400:empty', '中身のない呼び出しは、回数に数えない（先に断る）')
  const a = []
  for (let i = 0; i < 4; i++) a.push(await call('/api/read', 'srv-dev-1', memo))
  ok(a.slice(0, 3).every((s) => s.startsWith('502:')) && a[3] === '429:limit-device', `本物の窓口：1台3回まで（${a.join(' ')}）`)
  const p = await call('/api/post', 'srv-dev-2', { memo: '（架空）よく食べます。', facts: { name: 'テスト', goodPoints: [] } })
  const c = await call('/api/check', 'srv-dev-2', { memo: '（架空）よく食べます。', facts: { name: 'テスト', goodPoints: [] }, sentences: ['よく食べます。'] })
  const c2 = await call('/api/check', 'srv-dev-3', { memo: '（架空）よく食べます。', facts: { name: 'テスト', goodPoints: [] }, sentences: ['よく食べます。'] })
  ok(p.startsWith('502:') && c.startsWith('502:') && c2 === '429:limit-all', `本物の窓口：全体5回まで（本文 ${p}・確認 ${c}・別のスマホ ${c2}）`)
}

console.log(failures ? `確認NGが${failures}こあります` : 'すべて確認OK')
process.exit(failures ? 1 : 0)
