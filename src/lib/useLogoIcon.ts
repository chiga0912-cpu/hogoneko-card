import { useEffect, useState } from 'react'
import { loadImage } from './card'
import { drawLogoCircle } from './logo'

// 画面に出す丸いロゴ（カードと同じ作り方。src/lib/logo.ts）。白い台は足さない（11/7 作る人の決定）
// px：画面での直径。くっきり見えるよう、3倍の大きさで描いて縮めて出す
export function useLogoIcon(logo: Blob | null, theme: string, px: number): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    if (!logo) {
      setUrl(null)
      return
    }
    void loadImage(logo)
      .then((img) => {
        if (stop) return
        const d = px * 3
        const c = document.createElement('canvas')
        c.width = d
        c.height = d
        const x = c.getContext('2d')
        if (!x) return
        drawLogoCircle(x, img, 0, 0, d, theme)
        setUrl(c.toDataURL('image/png'))
      })
      .catch(() => !stop && setUrl(null))
    return () => {
      stop = true
    }
  }, [logo, theme, px])
  return url
}
