// 確認モード（アドレスの最後に ?sizes=1 を付けて開いたときだけ）。
// iPhoneの実機で、写真の大きさの数字を読むため。画面の上に「確認モード」と版の番号を小さく出す
// 日本語のキーボードで打つと「？」「＝」「１」が全角になることがある（11/5夜 iPhoneの確認で見つけた）。全角でも読む
export const CHECK_MODE = (() => {
  if (typeof location === 'undefined') return false
  let raw = location.pathname + location.search
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // 読めない文字はそのまま
  }
  // 全角の「？」はアドレスの一部（パス）として届くので、パスも合わせて見る。NFKCで全角を半角にそろえる
  return /\?sizes=1(?![0-9])/.test(raw.normalize('NFKC')) || new URLSearchParams(location.search).get('sizes') === '1'
})()

// 版の番号（コミットの番号の最初の7文字。vite.config.ts で入れる）
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '手元'
