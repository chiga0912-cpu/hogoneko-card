// ツールで扱うデータの形

export type Shelter = {
  name: string
  themeColor: string
  logoUrl: string | null
  contact: string
  fixedText: string // 毎回同じ文章（例：予約不要、当日は連れて帰れない）
  hashtags: string
}

export type Health<T extends string> = {
  value: T | ''
  showOnCard: boolean
}

export type Cat = {
  photos: string[] // 写真（1〜3枚）。スマホの中だけで表示する
  name: string
  age: string
  sex: '' | 'オス' | 'メス'
  personality: string
  rescueStory: string
  nowStory: string
  carerWords: string // 預かりさん・スタッフさんのひとこと（書き換えない）
  vaccine: Health<'済み' | '1回目済み' | 'まだ'>
  neuter: Health<'済み' | '予定' | 'まだ'>
  virusTest: Health<'陰性' | '未検査'>
}

export const emptyShelter: Shelter = {
  name: '',
  themeColor: '#e8826b',
  logoUrl: null,
  contact: '',
  fixedText: '',
  hashtags: '',
}

export const emptyCat: Cat = {
  photos: [],
  name: '',
  age: '',
  sex: '',
  personality: '',
  rescueStory: '',
  nowStory: '',
  carerWords: '',
  vaccine: { value: '', showOnCard: false },
  neuter: { value: '', showOnCard: false },
  virusTest: { value: '', showOnCard: false },
}

export const MAX_PHOTOS = 3
