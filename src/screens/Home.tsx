import type { Screen } from '../App'
import type { Shelter } from '../types'
import { useBlobUrl } from '../lib/useBlobUrls'

type Props = {
  shelter: Shelter
  catCount: number
  draftName: string | null // 入力の途中の子の名前（途中がなければ null）
  unreadableCats: number // 名簿の中で読めなかった子の数（消さずに残している）
  draftUnreadable: boolean // 入力の途中が読めなかった
  storageWarning: boolean // ホーム画面に追加する案内を飛ばして、ブラウザのまま使っている
  onNew: () => void
  onContinue: () => void
  go: (s: Screen) => void
}

export default function Home({
  shelter,
  catCount,
  draftName,
  unreadableCats,
  draftUnreadable,
  storageWarning,
  onNew,
  onContinue,
  go,
}: Props) {
  const logoUrl = useBlobUrl(shelter.logo)
  return (
    <main className="screen">
      <header className="hero">
        <div className="hero-org">
          {logoUrl && <img className="hero-logo" src={logoUrl} alt="" />}
          <p className="hero-sub">{shelter.name}</p>
        </div>
        <h1>保護猫カード</h1>
        <p className="hero-lead">写真を選んで、短く書くか貼るだけ。リール用の動画と投稿文をつくります</p>
      </header>

      {draftUnreadable && <p className="notice">入力の途中の内容が読めなかったので、ホームから始めます。</p>}
      {unreadableCats > 0 && (
        <p className="notice">
          名簿の中に、読めなかった子が{unreadableCats}匹います。消さずに残してあります。
        </p>
      )}

      <div className="stack">
        {draftName !== null && (
          <button className="btn btn-big btn-continue" onClick={onContinue}>
            入力の続き（{draftName}）
          </button>
        )}
        <button className="btn btn-primary btn-big" onClick={onNew}>
          新しい子を紹介
        </button>
        <button className="btn btn-big" onClick={() => go('roster')} disabled={catCount === 0}>
          名簿から選ぶ
          <span className="count">{catCount}匹</span>
        </button>
        <button className="btn btn-big" disabled>
          譲渡会の案内
          <span className="soon">準備中</span>
        </button>
        <button className="btn btn-ghost" onClick={() => go('shelter')}>
          シェルター情報を直す
        </button>
      </div>

      {storageWarning && (
        <p className="muted home-warning">
          ホーム画面に追加しないと、しばらく開かないときに名簿が消えることがあります。
        </p>
      )}
    </main>
  )
}
