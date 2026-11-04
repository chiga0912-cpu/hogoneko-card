import { useEffect, useMemo } from 'react'

// Blob（写真・ロゴ）を画面に出すためのアドレスを作り、使い終わったら片づける
export function useBlobUrls(blobs: Blob[]): string[] {
  const urls = useMemo(() => blobs.map((b) => URL.createObjectURL(b)), [blobs])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  return urls
}

export function useBlobUrl(blob: Blob | null): string | null {
  const blobs = useMemo(() => (blob ? [blob] : []), [blob])
  return useBlobUrls(blobs)[0] ?? null
}
