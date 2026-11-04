import { useState } from 'react'
import { MAX_HASHTAGS, type Shelter } from '../types'
import { countHashtags } from '../lib/hashtags'
import { TopBar } from './ShelterForm'

type Props = {
  shelter: Shelter
  post: string
  onPostChange: (s: string) => void
  onBack: () => void
  onSave: () => Promise<void>
}

// 確認（仮）。カードと根拠の印は11/5〜11/6に作る。今は決まった形の投稿文だけ
export default function Preview({ shelter, post, onPostChange, onBack, onSave }: Props) {
  const [saving, setSaving] = useState(false)
  const tagCount = countHashtags(post)
  const tooMany = tagCount > MAX_HASHTAGS
  return (
    <main className="screen">
      <TopBar title="確認（仮）" onBack={onBack} />
      <p className="note">カードはこれから作ります。今は投稿文だけ確かめられます。</p>

      {shelter.hashtags.length > MAX_HASHTAGS && (
        <p className="notice">
          ハッシュタグが{shelter.hashtags.length}こ登録されています。投稿文には最初の{MAX_HASHTAGS}こだけ入れました。
        </p>
      )}

      {tooMany && (
        <p className="alert">
          投稿文にハッシュタグが{tagCount}こあります。1投稿{MAX_HASHTAGS}こまでです。減らすと先へ進めます。
        </p>
      )}

      <label className="field">
        <span>投稿文（その場で直せます）</span>
        <textarea rows={14} value={post} onChange={(e) => onPostChange(e.target.value)} />
        <small className="muted">入れた項目を決まった形に並べた文章です。AIで整えるのは次の段階です</small>
      </label>

      <div className="bottom-bar">
        <button
          className="btn btn-primary btn-big"
          disabled={saving || tooMany}
          onClick={async () => {
            setSaving(true)
            await onSave()
          }}
        >
          名簿に保存する
        </button>
      </div>
    </main>
  )
}
