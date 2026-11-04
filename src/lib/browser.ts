// どのブラウザで、どう開いているか（ホーム画面に追加する案内のため）

export type Browser = 'safari' | 'chrome' | 'other-ios' | 'not-ios'

export function detectBrowser(ua = navigator.userAgent): Browser {
  // iPadはパソコンのふりをすることがあるので、指で触れるかも見る
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  if (!isIOS) return 'not-ios'
  if (/CriOS\//.test(ua)) return 'chrome' // iPhoneのChromeは「CriOS」と名乗る
  if (/FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo|GSA\//.test(ua)) return 'other-ios'
  if (/Safari\//.test(ua)) return 'safari'
  return 'other-ios' // アプリの中のブラウザ（LINEなど）
}

// ホーム画面のアイコンから開いているか
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export function openedAs(): string {
  if (isStandalone()) return 'ホーム画面のアプリ'
  switch (detectBrowser()) {
    case 'safari':
      return 'Safari'
    case 'chrome':
      return 'Chrome'
    case 'other-ios':
      return 'そのほかのブラウザ'
    default:
      return 'iPhone以外'
  }
}
