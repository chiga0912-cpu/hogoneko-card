import type { Screen } from '../App'
import type { Shelter } from '../types'
import { useBlobUrl } from '../lib/useBlobUrls'

type Props = {
  shelter: Shelter
  catCount: number
  draftName: string | null // 入力の途中の子の名前（途中がなければ null）
  onNew: () => void
  onContinue: () => void
  go: (s: Screen) => void
}

export default function Home({ shelter, catCount, draftName, onNew, onContinue, go }: Props) {
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
    </main>
  )
}
