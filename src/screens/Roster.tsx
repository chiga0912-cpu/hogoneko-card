import { useMemo } from 'react'
import type { CatSummary } from '../db'
import { ageText } from '../lib/age'
import { useBlobUrls } from '../lib/useBlobUrls'
import { TopBar } from './ShelterForm'

type Props = {
  cats: CatSummary[]
  pickError: boolean // 選んだ子の写真が読めなかった
  onBack: () => void
  onPick: (c: CatSummary) => void
  onDelete: (id: string) => void
}

export default function Roster({ cats, pickError, onBack, onPick, onDelete }: Props) {
  // 一覧には小さな表紙だけ出す（写真そのものは、選んだときに読む）
  const covers = useMemo(() => cats.map((c) => c.cover ?? new Blob()), [cats])
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
              {c.cover ? <img src={urls[i]} alt="" /> : <span className="roster-noimg" />}
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

      {pickError && (
        <div className="bottom-bar">
          <p className="alert bar-alert" role="alert">
            写真を読み込めませんでした。名簿は消していません。もう一度押してください。
          </p>
        </div>
      )}
    </main>
  )
}
