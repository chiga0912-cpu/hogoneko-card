// Claudeを呼ぶ回数の上限（#20。SPEC 4.3）
// - 1日（日本時間）の回数を、全体と1台ごとに数える。数える場所は Cloudflare KV（バインド名 LIMITS）
// - LIMITS がないときは、Claudeを呼ばない（上限なしで公開アドレスに載ることがないように。止まる側に倒す）
// - 本当に費用を止めるのは「全体」の上限。1台ごとの数え方は、画面が送る番号（なければ接続元を短く変えたもの）なので、
//   わざと番号を変えれば数え直せてしまう。1台ごとの上限は、ふつうに使っていて1台で使いすぎないための目安
// - KV は、ほぼ同時の呼び出しでは数が少しずれることがある（あとから書いたほうが勝つ・ほかの場所に届くまで時間がかかる）。
//   上限を少し超えることはありうる（DEVLOG に書いた）
// - 受け取ったメモや本文は、ここでは見ない・残さない。残すのは日付ごとの回数だけ（2日で消える）

type KV = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
}
export type LimitEnv = { LIMITS?: KV; LIMIT_DAY_ALL?: string; LIMIT_DAY_DEVICE?: string }

// まだ決まっていない数字（SPEC 11章）。作者が決めたら、Cloudflare の環境変数で替える ⚙
export const DEFAULT_DAY_ALL = 300
export const DEFAULT_DAY_DEVICE = 50
const KEEP_SECONDS = 2 * 24 * 60 * 60

const num = (v: string | undefined, d: number) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : d
}

// 日本時間の日付（例 2026-11-06）
export const tokyoDay = (now = Date.now()) => new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

// 1台の見分け方：画面が送る番号。なければ接続元（IPアドレス）を短い記号に変えたもの（IPアドレスそのものは残さない）
async function deviceKey(request: Request): Promise<string> {
  const id = request.headers.get('x-device') ?? ''
  if (/^[A-Za-z0-9-]{8,64}$/.test(id)) return 'd:' + id
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hogoneko:' + ip))
  return 'i:' + [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 1回分を数える。数えられたら null、断るときは返す答え（Response）
// need：この呼び出しのあとに続けて使う回数も含めて、残りがいくつ要るか（本文を書く呼び出しは、続く根拠の確認の分も残っているときだけ通す）
export async function takeCall(request: Request, env: LimitEnv, need = 1, now = Date.now()): Promise<Response | null> {
  const kv = env.LIMITS
  if (!kv) return json({ error: 'no-limit' }, 503)
  const day = tokyoDay(now)
  const allKey = `n:all:${day}`
  const devKey = `n:${await deviceKey(request)}:${day}`
  let all = 0
  let dev = 0
  try {
    ;[all, dev] = (await Promise.all([kv.get(allKey), kv.get(devKey)])).map((v) => Number(v) || 0)
  } catch {
    return json({ error: 'no-limit' }, 503) // 数えられないときは呼ばない
  }
  if (all + need > num(env.LIMIT_DAY_ALL, DEFAULT_DAY_ALL)) return json({ error: 'limit-all' }, 429)
  if (dev + need > num(env.LIMIT_DAY_DEVICE, DEFAULT_DAY_DEVICE)) return json({ error: 'limit-device' }, 429)
  try {
    // 同じ鍵へは1秒に1回までしか書けない（KV の決まり）。書けなかったときも、読んだ数が上限より下なので通す（少し超えることがある）
    await Promise.all([kv.put(allKey, String(all + 1), { expirationTtl: KEEP_SECONDS }), kv.put(devKey, String(dev + 1), { expirationTtl: KEEP_SECONDS })])
  } catch {
    // 通す
  }
  return null
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
