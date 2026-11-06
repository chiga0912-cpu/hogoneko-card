// Claudeの窓口（/api/read・/api/post・/api/check）を呼ぶ（#20 回数の上限）
// - このスマホの番号（ばらばらの文字。名前や機種は入らない）を付けて送る。1台ごとの回数を数えるため
// - 上限のときは、画面に出す短い文を返す（Claudeが使えなくても、手で入れて最後まで進める。SPEC 4.4）

const DEVICE_KEY = 'hogoneko-device'
let memo: string | null = null
export function deviceId(): string {
  if (memo) return memo
  try {
    const saved = localStorage.getItem(DEVICE_KEY)
    if (saved && /^[A-Za-z0-9-]{8,64}$/.test(saved)) return (memo = saved)
    const id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
    return (memo = id)
  } catch {
    // 残せないとき（プライベートなど）は、開いている間だけの番号
    return (memo = crypto.randomUUID())
  }
}

export type ClaudeAnswer<T> = { ok: true; body: T } | { ok: false; error: string }

export async function callClaude<T>(path: '/api/read' | '/api/post' | '/api/check', payload: unknown): Promise<ClaudeAnswer<T>> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device': deviceId() },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) return { ok: false, error: body.error ?? String(res.status) }
    return { ok: true, body }
  } catch {
    return { ok: false, error: 'network' }
  }
}

// 回数の上限のときの文（ほかの失敗では null。画面ごとのいつもの文を出す）
export function limitText(error: string | null | undefined): string | null {
  if (error === 'limit-all') return '今日、Claudeを使える回数の上限になりました（みんなで使う分）。明日の0時（日本時間）すぎから、また使えます。'
  if (error === 'limit-device') return 'このスマホで今日Claudeを使える回数の上限になりました。明日の0時（日本時間）すぎから、また使えます。'
  return null
}
