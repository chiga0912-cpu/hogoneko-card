import type { Browser } from '../lib/browser'

export const GUIDE_SKIPPED_KEY = 'install-guide-skipped'

// iPhoneで確かめた結果：アイコンを消して追加し直すと、データは消えていた（DEVLOG 11/4）
export const ICON_WARNING = 'このアイコンを消すと、名簿も消えます（追加し直しても戻りません）。'

type Props = { browser: Browser; onSkip: () => void }

// 初めて開いたとき、シェルター登録の前に出す。
// Safariの手順は、iPhone 15 Plus・iOS 27.0.1 の本物の画面に合わせた（DEVLOG 11/4）
// ホーム画面から開くと、名簿が消えにくくなる。Safariとホーム画面のアプリでは中身が別々なので、登録の前に案内する
export default function InstallGuide({ browser, onSkip }: Props) {
  return (
    <main className="screen">
      <header className="hero hero-small">
        <h1>はじめに</h1>
        <p className="hero-lead">
          ホーム画面に追加して、そこから開いてください。名簿が消えにくくなります。
        </p>
      </header>

      {browser === 'safari' && (
        <ol className="steps">
          <li>
            画面下のアドレス欄の左にある<b>横線3本</b>のボタンを押す
            <small>横線3本が見つからないときは「…」を探してください</small>
          </li>
          <li>
            <b>「共有」</b>を押す
          </li>
          <li>
            <b>「表示を増やす」</b>を押して、<b>「ホーム画面に追加」</b>を押す
          </li>
          <li>
            右上の<b>「追加」</b>を押す
          </li>
          <li>
            このページを閉じて、ホーム画面にできたアイコンから開く
            <small className="warn">{ICON_WARNING}</small>
          </li>
        </ol>
      )}
      {browser === 'safari' && (
        <p className="muted guide-private">
          プライベートブラウズでは「ホーム画面に追加」が出ないことがあります。ふつうの画面で開いてください。
        </p>
      )}

      {browser === 'chrome' && (
        <ol className="steps">
          <li>
            <b>共有ボタン</b>（四角から矢印が出ている形）を押す
          </li>
          <li>
            出てきた一覧を<b>下までスクロール</b>して、<b>「ホーム画面に追加」</b>を押す
          </li>
          <li>
            <b>「追加」</b>を押す
          </li>
          <li>
            このページを閉じて、ホーム画面にできたアイコンから開く
            <small className="warn">{ICON_WARNING}</small>
          </li>
        </ol>
      )}

      {browser === 'other-ios' && (
        <p className="card-box">
          このブラウザでは、ホーム画面に追加できないことがあります。
          <br />
          できれば<b>Safari</b>でこのページを開き、ホーム画面に追加してください。
        </p>
      )}

      <p className="note-box">
        名簿や登録した内容は、ブラウザごと（Safari・Chrome・ホーム画面のアプリ）に分かれて残ります。いつも同じところから開いてください。
      </p>

      <div className="bottom-bar">
        <button className="btn btn-ghost btn-big" onClick={onSkip}>
          追加せずに、このまま使う
        </button>
      </div>
    </main>
  )
}
