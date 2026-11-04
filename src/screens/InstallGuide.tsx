import type { Browser } from '../lib/browser'

export const GUIDE_SKIPPED_KEY = 'install-guide-skipped'

type Props = { browser: Browser; onSkip: () => void }

// 初めて開いたとき、シェルター登録の前に出す。
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
            画面の下（または上）の<b>共有ボタン</b>（四角から矢印が出ている形）を押す
            <small>見つからないときは「…」を押すと出てきます</small>
          </li>
          <li>
            <b>「ホーム画面に追加」</b>を押す
            <small>見つからないときは、下へずらして探してください</small>
          </li>
          <li>
            右上の<b>「追加」</b>を押す
          </li>
          <li>このページを閉じて、ホーム画面にできたアイコンから開く</li>
        </ol>
      )}

      {browser === 'chrome' && (
        <ol className="steps">
          <li>
            アドレス欄の右の<b>共有ボタン</b>（四角から矢印が出ている形）を押す
            <small>見つからないときは、右下の「…」から探してください</small>
          </li>
          <li>
            <b>「ホーム画面に追加」</b>を押す
          </li>
          <li>
            <b>「追加」</b>を押す
          </li>
          <li>このページを閉じて、ホーム画面にできたアイコンから開く</li>
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
