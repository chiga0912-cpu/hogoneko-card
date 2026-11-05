// 確認モード（アドレスの最後に ?sizes=1 を付けて開いたときだけ）。
// iPhoneの実機で、写真の大きさの数字を読むため。画面の上に「確認モード」と版の番号を小さく出す
export const CHECK_MODE =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('sizes') === '1'

// 版の番号（コミットの番号の最初の7文字。vite.config.ts で入れる）
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '手元'
