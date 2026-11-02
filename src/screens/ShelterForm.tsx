import type { Shelter } from '../types'

type Props = {
  shelter: Shelter
  onChange: (s: Shelter) => void
  onDone: () => void
}

export default function ShelterForm({ shelter, onChange, onDone }: Props) {
  const set = <K extends keyof Shelter>(key: K, value: Shelter[K]) =>
    onChange({ ...shelter, [key]: value })

  const pickLogo = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (shelter.logoUrl) URL.revokeObjectURL(shelter.logoUrl)
    set('logoUrl', URL.createObjectURL(file))
  }

  return (
    <main className="screen">
      <TopBar title="シェルター情報" onBack={onDone} />
      <p className="note">最初に一度だけ登録します。毎回のカードと投稿文に入ります。</p>

      <label className="field">
        <span>団体名</span>
        <input value={shelter.name} onChange={(e) => set('name', e.target.value)} />
      </label>

      <label className="field">
        <span>テーマ色</span>
        <div className="color-row">
          <input
            type="color"
            value={shelter.themeColor}
            onChange={(e) => set('themeColor', e.target.value)}
          />
          <span className="muted">{shelter.themeColor}</span>
        </div>
      </label>

      <div className="field">
        <span>ロゴ</span>
        <div className="logo-row">
          {shelter.logoUrl && <img className="logo-thumb" src={shelter.logoUrl} alt="ロゴ" />}
          <label className="btn btn-small">
            {shelter.logoUrl ? 'ロゴを変える' : 'ロゴを選ぶ'}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => pickLogo(e.target.files)}
            />
          </label>
        </div>
      </div>

      <label className="field">
        <span>連絡先</span>
        <textarea
          rows={2}
          placeholder="例：Instagramのメッセージ、電話番号など"
          value={shelter.contact}
          onChange={(e) => set('contact', e.target.value)}
        />
      </label>

      <label className="field">
        <span>毎回同じ文章</span>
        <textarea
          rows={3}
          placeholder="例：予約不要です／当日は連れて帰れません"
          value={shelter.fixedText}
          onChange={(e) => set('fixedText', e.target.value)}
        />
      </label>

      <label className="field">
        <span>いつものハッシュタグ</span>
        <textarea
          rows={2}
          placeholder="#保護猫 #里親募集"
          value={shelter.hashtags}
          onChange={(e) => set('hashtags', e.target.value)}
        />
      </label>

      <div className="bottom-bar">
        <button className="btn btn-primary btn-big" onClick={onDone}>
          保存する
        </button>
      </div>
    </main>
  )
}

export function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="topbar">
      <button className="back" onClick={onBack} aria-label="戻る">
        ‹ 戻る
      </button>
      <h2>{title}</h2>
    </div>
  )
}
