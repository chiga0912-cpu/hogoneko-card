import { MAX_HASHTAGS } from '../types'

// 「#保護猫 #里親募集」「保護猫、里親募集」などを、1つずつに分ける。同じものは1つにする
export function parseHashtags(text: string): string[] {
  const tags = text
    .split(/[\s,、，]+/)
    .map((t) => t.replace(/^[#＃]+/, '').trim())
    .filter(Boolean)
    .map((t) => `#${t}`)
  return [...new Set(tags)]
}

// 投稿文に付けるのは5つまで（AIに任せず、ここで必ず守る）
export const limitHashtags = (tags: string[]) => tags.slice(0, MAX_HASHTAGS)

// できあがった投稿文の中のハッシュタグを数える（「#」「＃」どちらも）。
// ひとことや、あとから直した文に「#」が入っていても、ここで数えて5つを超えたら先へ進めない
export function countHashtags(text: string): number {
  return (text.match(/[#＃][^\s#＃]+/g) ?? []).length
}
