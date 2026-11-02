import type { Screen } from '../App'
import type { Shelter } from '../types'

type Props = { shelter: Shelter; go: (s: Screen) => void }

export default function Home({ shelter, go }: Props) {
  return (
    <main className="screen">
      <header className="hero">
        <p className="hero-sub">{shelter.name || 'シェルター名は未登録'}</p>
        <h1>保護猫カード</h1>
        <p className="hero-lead">写真とひとことで、リール用の素材と投稿文をつくります</p>
      </header>

      <div className="stack">
        <button className="btn btn-primary btn-big" onClick={() => go('cat')}>
          1匹の紹介をつくる
        </button>
        <button className="btn btn-big" disabled>
          譲渡会セットをつくる
          <span className="soon">準備中</span>
        </button>
        <button className="btn btn-ghost" onClick={() => go('shelter')}>
          シェルター情報{shelter.name ? 'を直す' : 'を登録する'}
        </button>
      </div>
    </main>
  )
}
