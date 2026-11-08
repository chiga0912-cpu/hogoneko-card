// ツールで扱うデータの形（SPEC.md 5章）
// 写真・ロゴ・動画は Blob のまま、スマホの中（IndexedDB）にだけ保存する

export type Shelter = {
  name: string // 必須
  themeColor: string
  logo: Blob | null
  contact: string
  fixedText: string // 毎回同じ文章（例：予約不要、当日は連れて帰れない）
  hashtags: string[] // いつものハッシュタグ（「#」付き）。投稿文には5つまで
  venues: string[] // いつもの譲渡会場所
  // 次の譲渡会（11/8 作者の決定。小さい版：シェルター情報に4つの欄を文字で入れる。名前と日付があるときだけ最後の1枚に出す）
  event?: ShelterEvent
}
export type ShelterEvent = { name: string; date: string; time: string; venue: string }

export const AGE_STAGES = ['子猫', '若い猫', 'おとなの猫', 'シニア猫'] as const
export type AgeStage = (typeof AGE_STAGES)[number]

export type Age = {
  mode: 'unknown' | 'birth' | 'stage'
  birthYear?: number
  birthMonth?: number // 1〜12
  estimated?: boolean // 生まれた年月が「推定」か
  stage?: AgeStage
}

export const SEXES = ['オス', 'メス', '未確認'] as const
export const VACCINES = ['済み', '1回目済み', 'まだ', '未確認'] as const
export const NEUTERS = ['済み', '予定', 'まだ', '未確認'] as const
export const VIRUS_TESTS = ['陰性', '未検査', '未確認'] as const

export type Sex = (typeof SEXES)[number]

// 健康の1項目。show = 投稿文に載せるか（最初は載せない）
export type Health<T extends string> = { value: T; show: boolean }

export type Framing = { x: number; y: number; scale: number }

// 撮った動画（11/5に選べるようにする）
export type Clip = { blob: Blob; start: number; length: number }

export type CatField = 'name' | 'age' | 'sex' | 'vaccine' | 'neuter' | 'virusTest' | 'goodPoints' | 'carerWords'

export type Cat = {
  id: string
  createdAt: number
  updatedAt: number
  photos: Blob[] // 1〜3枚。1枚目が表紙
  clip: Clip | null
  framing: Record<string, Framing> // カードごとの写真の位置（11/5）
  textPosition: 'up' | 'normal' | 'down'
  memo: string // 貼った元の文章
  memoAdditions: string // 聞き返しの答え
  name: string
  age: Age
  sex: Sex
  vaccine: Health<(typeof VACCINES)[number]>
  neuter: Health<(typeof NEUTERS)[number]>
  virusTest: Health<(typeof VIRUS_TESTS)[number]>
  healthCheckedAt: string | null // 健康情報を確認した日（YYYY-MM-DD）
  goodPoints: string[] // いいところ（1行に1つ）
  cardLines: string[] // カードに載せる行（11/5）
  carerWords: string // 預かりさん・スタッフさんのひとこと（書き換えない）
  sources: Partial<Record<CatField, string>> // 項目ごとの「メモから写した根拠」（Claudeを入れるとき）
}

// 譲渡会（画面は11/6）
export type AdoptionEvent = {
  id: string
  date: string // YYYY-MM-DD
  startTime: string
  endTime: string
  venue: string
  catIds: string[] // 並べる順
}

export const MAX_PHOTOS = 3
export const MAX_HASHTAGS = 5

export const emptyShelter = (): Shelter => ({
  name: '',
  themeColor: '#e8826b',
  logo: null,
  contact: '',
  fixedText: '',
  hashtags: [],
  venues: [],
})

export const newId = (): string =>
  // crypto.randomUUID は https でしか使えないので、使えないときは自前で作る
  typeof crypto !== 'undefined' && 'randomUUID' in crypto && window.isSecureContext
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const newCat = (): Cat => {
  const now = Date.now()
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    photos: [],
    clip: null,
    framing: {},
    textPosition: 'normal',
    memo: '',
    memoAdditions: '',
    name: '',
    age: { mode: 'unknown' },
    sex: '未確認',
    vaccine: { value: '未確認', show: false },
    neuter: { value: '未確認', show: false },
    virusTest: { value: '未確認', show: false },
    healthCheckedAt: null,
    goodPoints: [],
    cardLines: [],
    carerWords: '',
    sources: {},
  }
}
