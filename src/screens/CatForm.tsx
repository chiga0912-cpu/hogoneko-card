import { useState } from 'react'
import { MAX_PHOTOS, type Cat, type Health } from '../types'
import { TopBar } from './ShelterForm'

type Props = {
  cat: Cat
  onChange: (c: Cat) => void
  onBack: () => void
  onNext: () => void
}

export default function CatForm({ cat, onChange, onBack, onNext }: Props) {
  const [showErrors, setShowErrors] = useState(false)
  const set = <K extends keyof Cat>(key: K, value: Cat[K]) => onChange({ ...cat, [key]: value })

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    const room = MAX_PHOTOS - cat.photos.length
    const urls = Array.from(files)
      .slice(0, room)
      .map((f) => URL.createObjectURL(f))
    set('photos', [...cat.photos, ...urls])
  }

  const removePhoto = (i: number) => {
    URL.revokeObjectURL(cat.photos[i])
    set(
      'photos',
      cat.photos.filter((_, j) => j !== i),
    )
  }

  const missing = [
    cat.photos.length === 0 && '写真',
    !cat.name.trim() && '名前',
    !cat.age.trim() && '年齢',
    !cat.sex && '性別',
    !cat.personality.trim() && '性格のひとこと',
  ].filter(Boolean) as string[]

  const next = () => {
    if (missing.length) {
      setShowErrors(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    onNext()
  }

  return (
    <main className="screen">
      <TopBar title="猫の情報" onBack={onBack} />

      {showErrors && missing.length > 0 && (
        <p className="alert">まだ入っていません：{missing.join('、')}</p>
      )}

      <h3 className="section">必ず入れる</h3>

      <div className="field">
        <span>
          写真（{cat.photos.length}/{MAX_PHOTOS}枚）
        </span>
        <div className="photo-grid">
          {cat.photos.map((url, i) => (
            <div className="photo" key={url}>
              <img src={url} alt={`写真${i + 1}`} />
              <button className="photo-x" onClick={() => removePhoto(i)} aria-label="写真を外す">
                ×
              </button>
              {i === 0 && <span className="photo-tag">表紙</span>}
            </div>
          ))}
          {cat.photos.length < MAX_PHOTOS && (
            <label className="photo photo-add">
              ＋<br />
              写真を選ぶ
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  addPhotos(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          )}
        </div>
      </div>

      <label className="field">
        <span>名前</span>
        <input value={cat.name} onChange={(e) => set('name', e.target.value)} />
      </label>

      <label className="field">
        <span>年齢</span>
        <input
          placeholder="例：生後3か月、推定2歳"
          value={cat.age}
          onChange={(e) => set('age', e.target.value)}
        />
      </label>

      <div className="field">
        <span>性別</span>
        <Choices
          options={['オス', 'メス']}
          value={cat.sex}
          onChange={(v) => set('sex', v as Cat['sex'])}
        />
      </div>

      <label className="field">
        <span>性格のひとこと</span>
        <input
          placeholder="例：抱っこが大好きな甘えんぼう"
          value={cat.personality}
          onChange={(e) => set('personality', e.target.value)}
        />
      </label>

      <h3 className="section">わかれば入れる</h3>

      <label className="field">
        <span>保護したときの様子</span>
        <textarea rows={3} value={cat.rescueStory} onChange={(e) => set('rescueStory', e.target.value)} />
      </label>

      <label className="field">
        <span>今の様子</span>
        <textarea rows={3} value={cat.nowStory} onChange={(e) => set('nowStory', e.target.value)} />
      </label>

      <label className="field">
        <span>預かりさん・スタッフさんのひとこと</span>
        <textarea rows={3} value={cat.carerWords} onChange={(e) => set('carerWords', e.target.value)} />
        <small className="muted">書いた言葉のまま、カードに載せます</small>
      </label>

      <h3 className="section">健康のこと</h3>
      <HealthField
        label="ワクチン"
        options={['済み', '1回目済み', 'まだ']}
        health={cat.vaccine}
        onChange={(h) => set('vaccine', h as Cat['vaccine'])}
      />
      <HealthField
        label="不妊・去勢手術"
        options={['済み', '予定', 'まだ']}
        health={cat.neuter}
        onChange={(h) => set('neuter', h as Cat['neuter'])}
      />
      <HealthField
        label="猫エイズ・白血病の検査"
        options={['陰性', '未検査']}
        health={cat.virusTest}
        onChange={(h) => set('virusTest', h as Cat['virusTest'])}
      />

      <div className="bottom-bar">
        <button className="btn btn-primary btn-big" onClick={next}>
          プレビューへ
        </button>
      </div>
    </main>
  )
}

function Choices({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="choices">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`chip ${value === o ? 'chip-on' : ''}`}
          aria-pressed={value === o}
          onClick={() => onChange(value === o ? '' : o)}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function HealthField({
  label,
  options,
  health,
  onChange,
}: {
  label: string
  options: string[]
  health: Health<string>
  onChange: (h: Health<string>) => void
}) {
  return (
    <div className="field health">
      <span>{label}</span>
      <Choices options={options} value={health.value} onChange={(v) => onChange({ ...health, value: v })} />
      <label className="toggle">
        <input
          type="checkbox"
          checked={health.showOnCard}
          disabled={!health.value}
          onChange={(e) => onChange({ ...health, showOnCard: e.target.checked })}
        />
        カードに載せる
      </label>
    </div>
  )
}
