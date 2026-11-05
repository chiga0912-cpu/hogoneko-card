import { useState } from 'react'
import {
  AGE_STAGES,
  MAX_PHOTOS,
  NEUTERS,
  SEXES,
  VACCINES,
  VIRUS_TESTS,
  type Age,
  type Cat,
  type Health,
} from '../types'
import { shrinkPhoto, type ShrinkInfo } from '../lib/shrink'
import { CHECK_MODE } from '../lib/checkMode'
import { ageText, fromMonthValue, jpDate, toMonthValue, todayString } from '../lib/age'
import { useBlobUrls } from '../lib/useBlobUrls'
import { TopBar } from './ShelterForm'
import ClipPicker from './ClipPicker'

type Props = {
  cat: Cat
  fromRoster: boolean // 名簿から選んだ子か
  onChange: (update: (c: Cat) => Cat) => void
  onBack: () => void
  onNext: () => void
  autosaveFailed?: boolean // 入力の途中を残せなかった
  clipLost?: boolean // 選び直した動画を、途中に残せていなかった
}

type HealthKey = 'vaccine' | 'neuter' | 'virusTest'

// 写真の大きさの数字（?sizes=1 で開いたときだけ。写真の名前は出さない）
const SHOW_SIZES = CHECK_MODE
// 数字は写真1枚ずつにひもづける（外した写真の数字が残らないように。11/5 iPhoneで前の分が残って2行になったため）
const sizeOf = new WeakMap<Blob, ShrinkInfo>()
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`
const sizeText = (z: ShrinkInfo) =>
  z.result === 'kept-unreadable'
    ? `読めなかったので元のまま（${mb(z.fromBytes)}）`
    : `${z.fromW}×${z.fromH}・${mb(z.fromBytes)} → ${z.toW}×${z.toH}・${mb(z.toBytes)}・${(z.ms / 1000).toFixed(1)}秒${z.result === 'kept-small' ? '（元のまま）' : ''}`

// 入力（1画面）。並びは SPEC 2.2 のとおり
export default function CatForm({ cat, fromRoster, onChange, onBack, onNext, autosaveFailed, clipLost }: Props) {
  const [showErrors, setShowErrors] = useState(false)
  const [photoNote, setPhotoNote] = useState('')
  const set = <K extends keyof Cat>(key: K, value: Cat[K]) => onChange((c) => ({ ...c, [key]: value }))
  const photoUrls = useBlobUrls(cat.photos)

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    // 選ぶ欄はこのあと空にされるので、枚数は先に数えておく
    const total = files.length
    const room = MAX_PHOTOS - cat.photos.length
    const picked = Array.from(files).slice(0, room)
    try {
      setPhotoNote('写真を読み込んでいます…')
      // 1枚ずつ小さくする（何枚も同時に広げると、iPhoneが重さで止まるおそれがあるため）
      const copies: Blob[] = []
      for (const f of picked) {
        const r = await shrinkPhoto(f)
        copies.push(r.blob)
        sizeOf.set(r.blob, r.info)
      }
      onChange((c) => ({ ...c, photos: [...c.photos, ...copies].slice(0, MAX_PHOTOS) }))
      setPhotoNote(
        total > room ? `写真は${MAX_PHOTOS}枚までです。選んだうちの最初の${picked.length}枚を入れました。` : '',
      )
    } catch {
      setPhotoNote('写真を読み込めませんでした。もう一度選んでください。')
    }
  }

  const removePhoto = (i: number) => onChange((c) => ({ ...c, photos: c.photos.filter((_, j) => j !== i) }))
  const makeCover = (i: number) =>
    onChange((c) => ({ ...c, photos: [c.photos[i], ...c.photos.filter((_, j) => j !== i)] }))

  const setAge = (patch: Partial<Age>) => onChange((c) => ({ ...c, age: { ...c.age, ...patch } }))

  // 健康の値を直したら、確認した日を今日にする（「載せる」を変えただけのときは変えない）
  const setHealth = (key: HealthKey, h: Health<string>) =>
    onChange((c) => ({
      ...c,
      [key]: h,
      healthCheckedAt: c[key].value !== h.value ? todayString() : c.healthCheckedAt,
    }))

  const healthKnown = [cat.vaccine, cat.neuter, cat.virusTest].some((h) => h.value !== '未確認')
  const healthIsOld =
    fromRoster && healthKnown && cat.healthCheckedAt !== null && cat.healthCheckedAt !== todayString()

  const missing = [cat.photos.length === 0 && !cat.clip && '写真か動画', !cat.name.trim() && '名前'].filter(Boolean) as string[]

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
      <TopBar title={fromRoster ? `${cat.name}の紹介` : '新しい子の紹介'} onBack={onBack} />

      {showErrors && missing.length > 0 && <p className="alert">まだ入っていません：{missing.join('、')}</p>}

      {/* 1. 写真 */}
      <div className="field">
        <span>
          写真（{cat.photos.length}/{MAX_PHOTOS}枚） <em className="req">写真か動画が必須</em>
        </span>
        <div className="photo-grid">
          {cat.photos.map((_, i) => (
            <div className="photo" key={photoUrls[i]}>
              <img src={photoUrls[i]} alt={`写真${i + 1}`} />
              <button className="photo-x" onClick={() => removePhoto(i)} aria-label={`写真${i + 1}を外す`}>
                ×
              </button>
              {i === 0 ? (
                <span className="photo-tag">表紙</span>
              ) : (
                <button className="photo-tag photo-tag-btn" onClick={() => makeCover(i)}>
                  表紙にする
                </button>
              )}
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
                  void addPhotos(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          )}
        </div>
        {photoNote && <p className="notice">{photoNote}</p>}
        {SHOW_SIZES && cat.photos.some((b) => sizeOf.has(b)) && (
          <p className="muted" data-testid="photo-sizes">
            {cat.photos.map((b, i) => {
              const z = sizeOf.get(b)
              return (
                z && (
                  <span key={i}>
                    写真{i + 1}：{sizeText(z)}
                    <br />
                  </span>
                )
              )
            })}
          </p>
        )}
        <small className="muted">1枚目が表紙になります</small>
      </div>

      {/* 1. 動画（1本。つまみで始まりを選び、5秒を使う） */}
      <ClipPicker clip={cat.clip} onChange={(clip) => onChange((c) => ({ ...c, clip }))} />

      {/* 2. メッセージ欄 */}
      <label className="field">
        <span>預かりさんからのメッセージ・メモ</span>
        <textarea
          rows={5}
          placeholder="LINEやメールの文章を、ここに貼ってください。自分で書いてもOKです"
          value={cat.memo}
          onChange={(e) => set('memo', e.target.value)}
        />
        <small className="muted">🎤 キーボードのマイクで話して入れてもOK</small>
      </label>

      {/* 3. 読み取り（Claudeを入れるまでは押せない） */}
      <button className="btn btn-big" disabled>
        メッセージから読み取る
        <span className="soon">準備中</span>
      </button>
      <p className="muted center">今は、下の項目を手で入れてください</p>

      {/* 4. 項目 */}
      <label className="field">
        <span>
          名前 <em className="req">必須</em>
        </span>
        <input value={cat.name} onChange={(e) => set('name', e.target.value)} />
      </label>

      <div className="field">
        <span>年齢</span>
        <Choices
          label="年齢の入れ方"
          options={['不明', '生まれた年月', 'おおよその年代']}
          value={{ unknown: '不明', birth: '生まれた年月', stage: 'おおよその年代' }[cat.age.mode]}
          onChange={(v) =>
            setAge({ mode: v === '生まれた年月' ? 'birth' : v === 'おおよその年代' ? 'stage' : 'unknown' })
          }
        />
        {cat.age.mode === 'birth' && (
          <div className="sub">
            <input
              type="month"
              aria-label="生まれた年月"
              value={toMonthValue(cat.age)}
              max={todayString().slice(0, 7)}
              onChange={(e) => setAge(fromMonthValue(e.target.value))}
            />
            <label className="toggle">
              <input
                type="checkbox"
                checked={cat.age.estimated ?? false}
                onChange={(e) => setAge({ estimated: e.target.checked })}
              />
              推定
            </label>
            {ageText(cat.age) && <small className="muted">今は「{ageText(cat.age)}」。月齢は自動で増えます</small>}
          </div>
        )}
        {cat.age.mode === 'stage' && (
          <div className="sub">
            <Choices
              label="おおよその年代"
              options={[...AGE_STAGES]}
              value={cat.age.stage ?? ''}
              onChange={(v) => setAge({ stage: v as Age['stage'] })}
            />
          </div>
        )}
        {cat.age.mode === 'unknown' && <small className="muted">年齢は、カードにも投稿文にも書きません</small>}
      </div>

      <div className="field">
        <span>性別</span>
        <Choices label="性別" options={[...SEXES]} value={cat.sex} onChange={(v) => set('sex', v as Cat['sex'])} />
      </div>

      <h3 className="section">健康のこと</h3>
      {healthIsOld && (
        <div className="notice">
          <p>
            健康情報は前回（{jpDate(cat.healthCheckedAt!)}）のものです。
            <br />
            今も正しいですか？
          </p>
          <button className="btn btn-small" onClick={() => set('healthCheckedAt', todayString())}>
            今も正しい
          </button>
          <small>ちがうときは、下で直してください</small>
        </div>
      )}
      <HealthField
        label="ワクチン"
        options={[...VACCINES]}
        health={cat.vaccine}
        onChange={(h) => setHealth('vaccine', h)}
      />
      <HealthField
        label="不妊・去勢手術"
        options={[...NEUTERS]}
        health={cat.neuter}
        onChange={(h) => setHealth('neuter', h)}
      />
      <HealthField
        label="猫エイズ・白血病の検査"
        options={[...VIRUS_TESTS]}
        health={cat.virusTest}
        onChange={(h) => setHealth('virusTest', h)}
      />

      <label className="field">
        <span>いいところ</span>
        <textarea
          rows={4}
          placeholder={'1行に1つ\n例：ひざの上が大好き\n例：ごはんの時間を教えてくれる'}
          value={cat.goodPoints.join('\n')}
          onChange={(e) => set('goodPoints', e.target.value.split('\n'))}
        />
      </label>

      <label className="field">
        <span>預かりさん・スタッフさんのひとこと（なくてもOK）</span>
        <textarea rows={3} value={cat.carerWords} onChange={(e) => set('carerWords', e.target.value)} />
        <small className="muted">書いた言葉のまま載せます（書き換えません）</small>
      </label>

      <div className="bottom-bar">
        {/* どこまでスクロールしていても見えるように、ボタンのすぐ上に出す */}
        {clipLost && <p className="alert bar-alert">選んだ動画を残せていませんでした。もう一度、動画を選んでください。</p>}
        {autosaveFailed && (
          <p className="alert bar-alert">入力の途中を、スマホの中に残せませんでした。ほかのアプリに移ると、入力が消えることがあります。</p>
        )}
        <button className="btn btn-primary btn-big" onClick={next}>
          次へ
        </button>
      </div>
    </main>
  )
}

function Choices({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="choices" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`chip ${value === o ? 'chip-on' : ''}`}
          aria-pressed={value === o}
          onClick={() => onChange(o)}
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
  const unknown = health.value === '未確認'
  return (
    <div className="field health">
      <span>{label}</span>
      <Choices
        label={label}
        options={options}
        value={health.value}
        onChange={(v) => onChange({ value: v, show: v === '未確認' ? false : health.show })}
      />
      <label className={`toggle ${unknown ? 'toggle-off' : ''}`}>
        <input
          type="checkbox"
          checked={health.show && !unknown}
          disabled={unknown}
          onChange={(e) => onChange({ ...health, show: e.target.checked })}
        />
        投稿文に載せる
      </label>
    </div>
  )
}
