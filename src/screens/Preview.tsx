import { useState } from 'react'
import type { Cat, Shelter } from '../types'
import { TopBar } from './ShelterForm'

type Props = {
  cat: Cat
  shelter: Shelter
  post: string
  onPostChange: (s: string) => void
  onBack: () => void
  onNext: () => void
}

// 今日はカードの「枠」だけ。本物のカード画像は11/3に作る
export default function Preview({ cat, shelter, post, onPostChange, onBack, onNext }: Props) {
  const [index, setIndex] = useState(0)

  const healthOnCard = [
    cat.vaccine.showOnCard && cat.vaccine.value && `ワクチン ${cat.vaccine.value}`,
    cat.neuter.showOnCard && cat.neuter.value && `手術 ${cat.neuter.value}`,
    cat.virusTest.showOnCard && cat.virusTest.value && `検査 ${cat.virusTest.value}`,
  ].filter(Boolean) as string[]

  const frames = [
    { key: 'cover', label: '表紙', photo: cat.photos[0], big: cat.name, small: cat.personality },
    {
      key: 'cat',
      label: '猫カード',
      photo: cat.photos[1] ?? cat.photos[0],
      big: cat.name,
      small: [`${cat.age}・${cat.sex}`, cat.personality, ...healthOnCard].join('\n'),
    },
    ...(cat.carerWords
      ? [{ key: 'words', label: 'ひとこと', photo: cat.photos[2], big: '', small: `「${cat.carerWords}」` }]
      : []),
    {
      key: 'last',
      label: '最後の1枚',
      photo: undefined,
      big: shelter.name || '（団体名）',
      small: shelter.contact || '（連絡先はシェルター情報で登録）',
    },
  ]

  return (
    <main className="screen">
      <TopBar title="プレビュー" onBack={onBack} />
      <p className="note">左右にめくって確認できます（今日は仮の枠です）</p>

      <div
        className="carousel"
        onScroll={(e) => {
          const el = e.currentTarget
          setIndex(Math.round(el.scrollLeft / el.clientWidth))
        }}
      >
        {frames.map((f) => (
          <div className="slide" key={f.key}>
            <div className="frame">
              {f.photo && <img className="frame-photo" src={f.photo} alt="" />}
              <span className="frame-label">{f.label}</span>
              <div className="frame-text">
                {f.big && <strong>{f.big}</strong>}
                <p>{f.small}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="dots">
        {frames.map((f, i) => (
          <span key={f.key} className={i === index ? 'dot dot-on' : 'dot'} />
        ))}
      </div>

      <label className="field">
        <span>投稿文（その場で直せます）</span>
        <textarea rows={10} value={post} onChange={(e) => onPostChange(e.target.value)} />
        <small className="muted">今は入力を並べた仮の文章です。AIで整えるのは次の段階です</small>
      </label>

      <div className="bottom-bar">
        <button className="btn btn-primary btn-big" onClick={onNext}>
          保存へ
        </button>
      </div>
    </main>
  )
}
