import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

// 動画テスト用のページ（test.html）は、ふだんは公開に含めない。
// - 手元で使う：npm run dev を動かして http://localhost:5173/test.html を開く（いつでも使える）
// - もう一度公開する：Cloudflareの環境変数に VIDEO_TEST=1 を足して、公開し直す
//   （手元でためすなら VIDEO_TEST=1 npm run build）
const includeVideoTest = process.env.VIDEO_TEST === '1'

// 確認用の灰色の文字（開き方・消えにくい設定）は、試し用アドレスと手元だけに出す。
// Cloudflareは公開するとき、どのブランチかを CF_PAGES_BRANCH で教えてくれる。main（本番）では出さない
const showCheck = process.env.CF_PAGES_BRANCH !== 'main'

// 版の番号（コミットの番号の最初の7文字）。iPhoneで、新しい版が開いているかを見分けるため。
// Cloudflareは公開するとき CF_PAGES_COMMIT_SHA で教えてくれる。手元では git から読む
const appVersion = (() => {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD').toString().trim()
  } catch {
    return '手元'
  }
})()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SHOW_CHECK': JSON.stringify(showCheck ? '1' : '0'),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        ...(includeVideoTest ? { test: 'test.html' } : {}),
      },
    },
  },
})
