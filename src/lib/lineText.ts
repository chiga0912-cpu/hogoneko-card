// LINEのトーク履歴の形が貼られたときに、Claudeに送る前に、時刻・名前・スタンプなどを外す（SPEC 4.2・issue #12）
// ふだんの流れは「メッセージを1通ずつ長押ししてコピーして貼る」（11/5 作者がiPhoneで確認：文章だけになり、時刻や名前は付かない）。
// 履歴の形は備え。外せない行は、黙って捨てずにそのまま残す。貼った文章そのものは変えない（ここでは送る文章を作るだけ）

export type Cleaned = {
  isHistory: boolean // 履歴の形だったか
  text: string // Claudeに送る文章
  removed: number // 外した行の数（時刻と名前だけを外した行も数える）
}

const SEP = '(?:\\t| {2,}|\\u3000)' // 区切りはタブと思われる（目で見ただけ）。空白2つ以上・全角の空白でも読む
const MSG = new RegExp(`^(?:午前|午後)?\\d{1,2}:\\d{2}${SEP}+([^\\t]*?)${SEP}+(.*)$`)
const MSG_NO_BODY = new RegExp(`^(?:午前|午後)?\\d{1,2}:\\d{2}${SEP}+[^\\t]+$`)
const HEADER = /^\[LINE\]/
const SAVED_AT = /^保存日時[：:]/
const DATE = /^\d{4}\/\d{1,2}\/\d{1,2}\s*[(（][日月火水木金土][)）]\s*$/
const ONLY_TAG = /^\[(スタンプ|写真|動画|ファイル|ボイスメッセージ|アルバム|位置情報|連絡先|ノート|画像|絵文字)\]$/

export function cleanLine(raw: string): Cleaned {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const msgCount = lines.filter((l) => MSG.test(l)).length
  const marked = lines.some((l) => HEADER.test(l) || SAVED_AT.test(l) || DATE.test(l.trim()))
  if (msgCount === 0 || (msgCount < 2 && !marked)) return { isHistory: false, text: raw, removed: 0 }

  // 送った人の名前（読めない行に名前が残っていたら「（送った人）」に置き換える。Claudeに名前を送らないため）
  const names = [...new Set(lines.map((l) => l.match(MSG)?.[1]?.trim()).filter((n): n is string => !!n))].sort((a, b) => b.length - a.length)
  const hideNames = (l: string) => names.reduce((s, n) => s.split(n).join('（送った人）'), l)
  const out: string[] = []
  let removed = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (HEADER.test(t) || SAVED_AT.test(t) || DATE.test(t)) {
      removed++
      continue
    }
    if (t === '') continue // 行のあいだの空行は、送る文章では詰める
    const m = line.match(MSG)
    if (!m) {
      if (MSG_NO_BODY.test(line)) {
        removed++
        continue
      }
      out.push(hideNames(line)) // 読めない行は、外さずに残す（名前だけ置き換える）
      continue
    }
    removed++ // 時刻と名前を外した
    let body = m[2]
    // "…" で囲まれた、何行かにわたるメッセージ
    if (body.startsWith('"') && !(body.length > 1 && body.endsWith('"') && !body.endsWith('""'))) {
      const parts = [body.slice(1)]
      let j = i + 1
      let closed = false
      while (j < lines.length) {
        const next = lines[j]
        if (/(^|[^"])"$/.test(next) || next === '"') {
          parts.push(next.slice(0, -1))
          closed = true
          break
        }
        parts.push(next)
        j++
      }
      if (closed) {
        i = j
        body = parts.join('\n')
      } else {
        body = body.slice(1) // 閉じる " が見つからなければ、この行だけを使い、次の行からはふつうに読む
      }
    } else if (body.length > 1 && body.startsWith('"') && body.endsWith('"')) {
      body = body.slice(1, -1)
    }
    body = body.replace(/""/g, '"')
    if (ONLY_TAG.test(body.trim())) continue // [スタンプ]・[写真] などだけのメッセージ
    out.push(body)
  }
  return { isHistory: true, text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed }
}
