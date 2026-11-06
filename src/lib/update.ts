import { APP_VERSION } from './checkMode'

// 新しい版が公開されているか（SPEC 2.9。11/6 作る人の決定）
// 公開するときに作る version.json（版の番号だけ）を、毎回サーバーに確かめて読む。開いている画面の版と違えば、その番号を返す
// 読めないとき（電波がない・手元で作っていない）は、知らせない
export async function newerVersion(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { version?: unknown }
    const v = typeof body.version === 'string' ? body.version.trim() : ''
    return v && v !== APP_VERSION ? v : null
  } catch {
    return null
  }
}
