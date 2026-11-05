import { useEffect, useMemo } from 'react'

// Blob（写真・ロゴ・動画）を画面に出すためのアドレスを作り、使い終わったら片づける。
// 片づけは少し待ってから行い、その間にもう一度使われたらやめる。
// 手元の確認用サーバー（React の StrictMode）では、画面の部品を一度外してすぐ付け直すため、
// すぐに片づけると、まだ使うアドレスが壊れていた（名簿の表紙が壊れて見える A15、読み込み直したあとの動画が出ない）
const pending = new Map<string, number>()

export function useBlobUrls(blobs: Blob[]): string[] {
  const urls = useMemo(() => blobs.map((b) => URL.createObjectURL(b)), [blobs])
  useEffect(() => {
    for (const u of urls) {
      const t = pending.get(u)
      if (t !== undefined) {
        window.clearTimeout(t)
        pending.delete(u)
      }
    }
    return () => {
      for (const u of urls)
        pending.set(
          u,
          window.setTimeout(() => {
            pending.delete(u)
            URL.revokeObjectURL(u)
          }, 1000),
        )
    }
  }, [urls])
  return urls
}

export function useBlobUrl(blob: Blob | null): string | null {
  const blobs = useMemo(() => (blob ? [blob] : []), [blob])
  return useBlobUrls(blobs)[0] ?? null
}
