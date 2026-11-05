// カードごとに、どの写真を使うか（SPEC 3.2 の表。となりのカードで同じ写真が続かないように ⚙。11/5夜 作る人のOK）
//   1枚：全部1枚目／2枚：表紙1・猫カード2・ひとこと1・最後の1枚2／3枚：表紙1・猫カード2・ひとこと3・最後の1枚1
//   動画だけ：表紙と猫カードは選んだ5秒の最初のコマ、ひとことはまん中のコマ、最後の1枚は最後のコマ
import type { Clip } from '../types'

export type CardKey = 'cover' | 'cat' | 'words' | 'end'

const TABLE: Record<number, Record<CardKey, number>> = {
  1: { cover: 0, cat: 0, words: 0, end: 0 },
  2: { cover: 0, cat: 1, words: 0, end: 1 },
  3: { cover: 0, cat: 1, words: 2, end: 0 },
}

// 写真の番号（0から）。写真がなければ null
export function photoIndex(count: number, key: CardKey): number | null {
  if (count <= 0) return null
  return TABLE[Math.min(3, count)][key]
}

// 動画だけのときに使うコマの時刻（秒）
export function clipTimeFor(clip: Pick<Clip, 'start' | 'length'>, key: CardKey): number {
  if (key === 'words') return clip.start + clip.length / 2
  if (key === 'end') return clip.start + Math.max(0, clip.length - 0.1)
  return clip.start
}
