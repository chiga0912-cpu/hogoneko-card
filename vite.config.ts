import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 動画テスト用のページ（test.html）は、ふだんは公開に含めない。
// - 手元で使う：npm run dev を動かして http://localhost:5173/test.html を開く（いつでも使える）
// - もう一度公開する：Cloudflareの環境変数に VIDEO_TEST=1 を足して、公開し直す
//   （手元でためすなら VIDEO_TEST=1 npm run build）
const includeVideoTest = process.env.VIDEO_TEST === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        ...(includeVideoTest ? { test: 'test.html' } : {}),
      },
    },
  },
})
