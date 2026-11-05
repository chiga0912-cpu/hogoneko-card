// 古い形（版0・1）の名簿を、版2の形（写真は別の置き場所、一覧には小さな表紙）に移す（issue #3）
// - 画面を出したあとに、うしろで1匹ずつ動かす。1匹ごとに少し休み、画面のボタンが押せない時間を作らない
// - 失敗した子は、そのまま古い形で残る（今までどおり読める）。次に開いたときにもう一度移す
// - スタッフさんには何も出さない（名簿はそのまま使えるため）。確認モードのときだけ数を出す
import * as db from '../db'
import { makeCover } from './shrink'

const rest = () => new Promise<void>((r) => setTimeout(r, 30))

// olds：一覧を読んだときの、古い形の子（cover には1枚目の写真そのものが入っている）。
// 表紙はそれから作る（大きな記録を読み直さない。読む回数が増えると、その間画面が止まるため）
export async function migrateOldCats(
  olds: db.CatSummary[],
  onProgress: (p: { moved: number; failed: number; left: number }) => void,
): Promise<void> {
  let moved = 0
  let failed = 0
  for (let i = 0; i < olds.length; i++) {
    await rest()
    try {
      const cover = await makeCover(olds[i].cover)
      await rest() // 表紙を作ったあとにも休む（写真を広げたすぐあとに、続けて書き込まない）
      // 書き込みの中で記録を読み直し、まだ古い形のときだけ移す
      if ((await db.migrateCat(olds[i].id, cover)) === 'moved') moved++
    } catch {
      failed++
    }
    onProgress({ moved, failed, left: olds.length - i - 1 })
  }
}
