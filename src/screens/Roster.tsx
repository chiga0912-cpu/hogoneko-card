import { useMemo } from 'react'
import type { Cat } from '../types'
import { ageText } from '../lib/age'
import { useBlobUrls } from '../lib/useBlobUrls'
import { TopBar } from './ShelterForm'

type Props = {
  cats: Cat[]
  onBack: () => void
  onPick: (c: Cat) => void
  onDelete: (id: string) => void
}

export default function Roster({ cats, onBack, onPick, onDelete }: Props) {
  // 一覧には表紙（1枚目）だけ出す
  const covers = useMemo(() => cats.map((c) => c.photos[0] ?? new Blob()), [cats])
  const urls = useBlobUrls(covers)

  return (
    <main className="screen">
      <TopBar title="名簿" onBack={onBack} />
      <p className="note">選ぶと、前の内容が入った状態で開きます。</p>

      {cats.length === 0 && <p className="muted">まだ誰もいません。</p>}

      <ul className="roster">
        {cats.map((c, i) => (
          <li key={c.id} className="roster-item">
            <button className="roster-main" onClick={() => onPick(c)}>
              {c.photos[0] ? <img src={urls[i]} alt="" /> : <span className="roster-noimg" />}
              <span className="roster-text">
                <strong>{c.name}</strong>
                <small>
                  {[ageText(c.age), c.sex !== '未確認' ? c.sex : ''].filter(Boolean).join('・') || '　'}
                </small>
                <small className="muted">{new Date(c.updatedAt).toLocaleDateString('ja-JP')} に保存</small>
              </span>
            </button>
            <button
              className="roster-del"
              aria-label={`${c.name}を名簿から消す`}
              onClick={() => {
                if (window.confirm(`${c.name}を名簿から消しますか？元に戻せません。`)) onDelete(c.id)
              }}
            >
              消す
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
