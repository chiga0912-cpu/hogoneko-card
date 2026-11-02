import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        // 動画テスト用のページ。テストが終わったら、この行を消して公開から外す
        test: 'test.html',
      },
    },
  },
})
