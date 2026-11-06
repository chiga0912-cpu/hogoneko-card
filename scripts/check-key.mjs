// APIキーが使えるかだけを確かめる（キーそのものは画面に出さない）
// 使い方：node scripts/check-key.mjs
// .dev.vars（GitHubに上げない設定）から ANTHROPIC_API_KEY を読み、モデルの情報を1回たずねる。
// モデルの情報をたずねるだけなので、文章は作らず、利用料はかからない
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'

let key = ''
try {
  const line = readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith('ANTHROPIC_API_KEY='))
  key = (line ?? '').split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '')
} catch {
  console.log('NG：.dev.vars が見つかりません（このフォルダの一番上に作ってください）')
  process.exit(1)
}
if (!key) {
  console.log('NG：.dev.vars に ANTHROPIC_API_KEY= の行がないか、値が空です')
  process.exit(1)
}
console.log(`キーの形：${key.startsWith('sk-ant-') ? 'sk-ant- で始まる' : 'sk-ant- で始まらない（貼り間違いかもしれません）'}・長さ ${key.length} 文字`)
const client = new Anthropic({ apiKey: key })
try {
  const m = await client.models.retrieve('claude-haiku-5-5')
  console.log(`OK：キーが使えました（${m.id} の情報を読めました）`)
} catch (e) {
  if (e instanceof Anthropic.AuthenticationError) console.log('NG：キーが正しくありません（作り直すか、貼り直してください）')
  else if (e instanceof Anthropic.PermissionDeniedError) console.log('NG：このキーでは使えません（権限）')
  else if (e instanceof Anthropic.APIError) console.log(`NG：${e.status}（${e.name}）`)
  else console.log(`NG：つながりませんでした（${e?.name ?? e}）`)
  process.exit(1)
}
