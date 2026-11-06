// 読み取り（SPEC 4章）の、AIに任せない部分。サーバー（functions/）と画面の両方で使う
// - 送る前に、電話番号・メールアドレスらしきものを伏せる
// - Claudeが返した「メモから写した根拠」が、メモの中に本当にあるかを照合する。なければ、その項目は入れない
// - ひとことは、メモの中の文字と一字一句同じときだけ入れる

export const AGE_STAGE_VALUES = ['子猫', '若い猫', 'おとなの猫', 'シニア猫'] as const

export type Sourced<T> = { value: T; source: string }
export type AgeHint = { kind: 'months' | 'years' | 'stage'; amount: number | null; stage: (typeof AGE_STAGE_VALUES)[number] | null; source: string }
export type Extracted = {
  name: Sourced<string> | null
  sex: Sourced<'オス' | 'メス'> | null
  age: AgeHint | null
  vaccine: Sourced<'済み' | '1回目済み' | 'まだ'> | null
  neuter: Sourced<'済み' | '予定' | 'まだ'> | null
  virusTest: Sourced<'陰性' | '未検査'> | null
  goodPoints: { text: string; source: string }[]
  carerWords: string | null
}
export const EMPTY: Extracted = { name: null, sex: null, age: null, vaccine: null, neuter: null, virusTest: null, goodPoints: [], carerWords: null }

// ── 送る前に伏せる ──
const PHONE = /(?:\+81[-\s]?|0)\d{1,4}[-‐ー−―(（\s]?\d{1,4}[-‐ー−―)）\s]?\d{3,4}/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
export function maskContacts(text: string): { text: string; masked: number } {
  let masked = 0
  // 全角の数字・英字も見つけられるように、そろえてから探す（伏せない所の文字は変えない）
  const half = text.normalize('NFKC')
  if (half.length !== text.length) {
    // 文字数が変わる文字（まれ）があるときは、そろえた文で伏せる
    const t = half.replace(EMAIL, () => (masked++, '［メール］')).replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 10 ? (masked++, '［電話番号］') : m))
    return { text: t, masked }
  }
  let out = text
  for (const re of [EMAIL, PHONE]) {
    const found: [number, number][] = []
    for (const m of half.matchAll(re)) {
      if (re === PHONE && m[0].replace(/\D/g, '').length < 10) continue // 10けた未満は電話番号と見なさない（日付や体重を伏せないため）
      found.push([m.index!, m.index! + m[0].length])
    }
    for (const [a, b] of found.reverse()) {
      out = out.slice(0, a) + (re === EMAIL ? '［メール］' : '［電話番号］') + out.slice(b)
      masked++
    }
  }
  return { text: out, masked }
}

// ── 根拠の照合 ──
// 空白・全角半角をそろえてから比べる（SPEC 4.2）
export const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
export const inMemo = (memo: string, source: string) => !!source.trim() && norm(memo).includes(norm(source))

const KANJI_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }
function hasNumber(source: string, n: number): boolean {
  const s = source.normalize('NFKC')
  if (new RegExp(`(^|[^0-9.])${String(n).replace('.', '\\.')}([^0-9]|$)`).test(s)) return true
  return Object.entries(KANJI_NUM).some(([k, v]) => v === n && s.includes(k))
}

// 項目ごとに、根拠がメモにあり、値が根拠と合っているものだけを残す
export function verify(memo: string, x: Extracted): { result: Extracted; dropped: string[] } {
  const dropped: string[] = []
  const keep = <T extends { source: string } | null>(label: string, v: T, extra: (v: NonNullable<T>) => boolean = () => true): T | null => {
    if (!v) return null
    if (inMemo(memo, v.source) && extra(v as NonNullable<T>)) return v
    dropped.push(label)
    return null
  }
  const has = (src: string, words: RegExp) => words.test(src.normalize('NFKC'))
  const result: Extracted = {
    name: keep('名前', x.name, (v) => !!v.value.trim() && norm(v.source).includes(norm(v.value))),
    sex: keep('性別', x.sex, (v) => has(v.source, /オス|メス|男の子|女の子|雄|雌|♂|♀|おとこのこ|おんなのこ/)),
    age: keep('年齢', x.age, (v) =>
      v.kind === 'stage' ? !!v.stage : v.amount !== null && v.amount > 0 && v.amount < (v.kind === 'months' ? 36 : 30) && hasNumber(v.source, v.amount),
    ),
    vaccine: keep('ワクチン', x.vaccine, (v) => has(v.source, /ワクチン|予防接種|接種/)),
    neuter: keep('不妊・去勢手術', x.neuter, (v) => has(v.source, /手術|去勢|避妊|不妊/)),
    virusTest: keep('猫エイズ・白血病の検査', x.virusTest, (v) => has(v.source, /エイズ|白血病|FIV|FeLV|ウイルス|検査/i)),
    goodPoints: x.goodPoints.filter((g) => {
      const ok = !!g.text.trim() && inMemo(memo, g.source)
      if (!ok) dropped.push(`いいところ「${g.text}」`)
      return ok
    }),
    carerWords: null,
  }
  // ひとこと：書き換えない。メモの中の文字と一字一句同じときだけ（空白・改行の違いも許さない。前後の空白だけ除く）
  // 文の途中で切らない：メモの中で、文の切れ目から始まり、文の終わりで終わっているときだけ
  const cw = x.carerWords?.trim()
  if (cw) {
    if (wholeSentences(memo.replace(/\r\n?/g, '\n'), cw)) result.carerWords = cw
    else dropped.push('ひとこと')
  }
  return { result, dropped }
}

const SENT_END = '。．.！!？?」』)）…'
function wholeSentences(memo: string, part: string): boolean {
  let from = 0
  for (;;) {
    const i = memo.indexOf(part, from)
    if (i < 0) return false
    const before = i === 0 ? '\n' : memo[i - 1]
    const after = i + part.length >= memo.length ? '\n' : memo[i + part.length]
    const startsOk = /\s/.test(before) || SENT_END.includes(before) || '「『（('.includes(before)
    const endsOk = SENT_END.includes(part[part.length - 1]) || /\s/.test(after)
    if (startsOk && endsOk) return true
    from = i + 1
  }
}

// 年齢の手がかりから、生まれた年月の「推定」の案を作る（確かな生まれ月としては出さない。SPEC 4.2）
export function birthGuess(hint: AgeHint, today = new Date()): { year: number; month: number } | null {
  if (hint.kind === 'stage' || hint.amount === null) return null
  const months = hint.kind === 'months' ? Math.round(hint.amount) : Math.round(hint.amount * 12)
  const d = new Date(today.getFullYear(), today.getMonth() - months, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}
