import { useEffect, useRef, useState } from 'react'
import { flushAllIn } from '../lib/typed'
import { emptyShelter, MAX_HASHTAGS, type Shelter } from '../types'
import { copyBlob, isPersisted } from '../db'
import { APP_VERSION } from '../lib/checkMode'
import { isStandalone, openedAs } from '../lib/browser'
import { ICON_WARNING } from './InstallGuide'
import { parseHashtags } from '../lib/hashtags'
import { useBlobUrl } from '../lib/useBlobUrls'

type Props = {
  initial: Shelter | null
  first: boolean // 初めての登録か（戻るボタンを出さない）
  needName?: boolean // 団体名が空のまま残っていて、入れるまで先へ進めない（戻るボタンを出さない。11/6 作者の決定・案1）
  onSave: (s: Shelter) => void | Promise<void>
  onBack: () => void
}

export default function ShelterForm({ initial, first, needName = false, onSave, onBack }: Props) {
  const [s, setS] = useState<Shelter>(initial ?? emptyShelter())
  const [tagsText, setTagsText] = useState((initial?.hashtags ?? []).join(' '))
  const [venuesText, setVenuesText] = useState((initial?.venues ?? []).join('\n'))
  const [showError, setShowError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const logoUrl = useBlobUrl(s.logo)
  const set = <K extends keyof Shelter>(key: K, value: Shelter[K]) => setS((prev) => ({ ...prev, [key]: value }))
  const tags = parseHashtags(tagsText)

  const pickLogo = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      set('logo', await copyBlob(file))
      setLogoFailed(false)
    } catch {
      setLogoFailed(true)
    }
  }

  const save = async () => {
    if (!s.name.trim()) {
      setShowError(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setSaving(true)
    setSaveFailed(false)
    try {
      await onSave({
      ...s,
      name: s.name.trim(),
      hashtags: tags,
      venues: venuesText
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean),
      event: s.event
        ? { name: s.event.name.trim(), date: s.event.date.trim(), time: s.event.time.trim(), venue: s.event.venue.trim() }
        : undefined,
      })
    } catch {
      setSaveFailed(true)
    }
    setSaving(false)
  }

  // ［保存］：変換を確定する前の文字も入れ、描き直された値で保存する（入力画面と同じ。見直しの中3）
  const formRoot = useRef<HTMLElement>(null)
  const saveLatest = useRef(save)
  saveLatest.current = save
  const onSaveClick = () => {
    flushAllIn(formRoot.current)
    window.setTimeout(() => void saveLatest.current(), 0)
  }

  return (
    <main className="screen" ref={formRoot}>
      {first ? (
        <header className="hero hero-small">
          <h1>シェルター登録</h1>
          <p className="hero-lead">最初に一度だけ。必ず入れるのは団体名だけです。ほかは、あとからでも入れられます。</p>
        </header>
      ) : needName ? (
        <header className="hero hero-small">
          <h1>シェルター情報</h1>
        </header>
      ) : (
        <TopBar title="シェルター情報" onBack={onBack} />
      )}

      {needName && (
        <p className="alert" role="alert" data-need-name="1">
          団体名が入っていません。動画の表紙と最後の1枚に使うので、団体名を入れて［保存する］を押してください。入力の途中や名簿は、そのまま残っています。
        </p>
      )}

      {showError && <p className="alert">団体名を入れてください</p>}

      <label className="field">
        <span>
          団体名 <em className="req">必須</em>
        </span>
        <input value={s.name} onChange={(e) => set('name', e.target.value)} />
      </label>

      <label className="field">
        <span>テーマ色</span>
        <div className="color-row">
          <input type="color" value={s.themeColor} onChange={(e) => set('themeColor', e.target.value)} />
          <span className="muted">カードやボタンの色になります</span>
        </div>
      </label>

      <div className="field">
        <span>ロゴ</span>
        <p className="muted" data-logo-hint>Instagramのアイコンと同じ画像を入れると、きれいに出ます。丸く切り抜いて表示します</p>
        {logoFailed && <p className="alert">ロゴを読み込めませんでした。もう一度選んでください。</p>}
        <div className="logo-row">
          {logoUrl && <img className="logo-thumb" src={logoUrl} alt="ロゴ" />}
          <label className="btn btn-small">
            {s.logo ? 'ロゴを変える' : 'ロゴを選ぶ'}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void pickLogo(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          {s.logo && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => set('logo', null)}>
              外す
            </button>
          )}
        </div>
        {/* 確認用（試し用のアドレスだけ。本番では出さない）：プログラムで描いた仮のロゴを入れて、カードでの見え方を確かめる */}
        {import.meta.env.VITE_SHOW_CHECK === '1' && (
          <div className="logo-row test-logos" data-test-logos>
            <span className="muted">確認用の仮のロゴ：</span>
            {TEST_LOGOS.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => void testLogo(kind).then((b) => b && set('logo', b))}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="field">
        <span>連絡先</span>
        <textarea
          rows={2}
          placeholder="例：InstagramのDMでお問い合わせください"
          value={s.contact}
          onChange={(e) => set('contact', e.target.value)}
        />
      </label>

      <label className="field">
        <span>毎回同じ文章</span>
        <textarea
          rows={3}
          placeholder="例：譲渡会は予約不要です。当日のお渡しはできません。"
          value={s.fixedText}
          onChange={(e) => set('fixedText', e.target.value)}
        />
      </label>

      <label className="field">
        <span>いつものハッシュタグ</span>
        <textarea
          rows={2}
          placeholder="#保護猫 #里親募集"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
        />
        <small className="muted">
          {tags.length}こ
          {tags.length > MAX_HASHTAGS && `。投稿文に入るのは${MAX_HASHTAGS}こまでです（作るときに選べます）`}
        </small>
      </label>

      <label className="field">
        <span>いつもの譲渡会場所</span>
        <textarea
          rows={2}
          placeholder="1行に1つ"
          value={venuesText}
          onChange={(e) => setVenuesText(e.target.value)}
        />
      </label>

      <div className="field" data-event-fields>
        <span>次の譲渡会</span>
        <p className="muted">名前と日付を入れると、動画の最後の1枚に出ます。空なら出しません。</p>
        {(
          [
            ['name', '譲渡会の名前', '例：ねこの会 譲渡会'],
            ['date', '日付', '例：11月23日（日）'],
            ['time', '時間', '例：13時〜16時'],
            ['venue', '場所', '例：ひだまり公民館'],
          ] as const
        ).map(([k, label, ph]) => (
          <label key={k} className="field event-field">
            <span>{label}</span>
            <input
              value={s.event?.[k] ?? ''}
              placeholder={ph}
              onChange={(e) => {
                const v = e.target.value
                setS((prev) => ({ ...prev, event: { ...(prev.event ?? { name: '', date: '', time: '', venue: '' }), [k]: v } }))
              }}
            />
          </label>
        ))}
      </div>

      {isStandalone() && <p className="icon-warning">{ICON_WARNING}</p>}

      {/* 確認用の灰色の文字。本番（スタッフさんに渡す版）では出さない */}
      {import.meta.env.VITE_SHOW_CHECK === '1' && <StorageStatus />}

      <div className="bottom-bar">
        {/* 押した場所のすぐ上に出す（スクロールしなくても見えるように） */}
        {saveFailed && <p className="alert bar-alert">保存できませんでした。もう一度押してください。</p>}
        <button className="btn btn-primary btn-big" onClick={onSaveClick} disabled={saving}>
          {first ? '登録して始める' : '保存する'}
        </button>
      </div>
    </main>
  )
}

// 確認用：今どこで開いているか、「消えにくい設定」が通っているか
function StorageStatus() {
  const [persisted, setPersisted] = useState<boolean | null | undefined>(undefined)
  useEffect(() => {
    void isPersisted().then(setPersisted)
  }, [])
  const label = persisted === undefined ? '…' : persisted === null ? '不明' : persisted ? '○' : '×'
  return (
    <p className="status-line">
      開き方：{openedAs()} ／ 消えにくい設定：{label} ／ 版：{APP_VERSION}
    </p>
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

// 確認用の仮のロゴ（プログラムで描く。画像のファイルはリポジトリに入れない）
// 透明：背景が透明な、色のついたロゴ／透明で暗い色：暗い写真や帯で見えにくくならないかを見る／白い背景：角が丸くなるかを見る
type TestLogo = 'clear' | 'dark' | 'white'
const TEST_LOGOS: [TestLogo, string][] = [
  ['clear', '透明'],
  ['dark', '透明で暗い色'],
  ['white', '白い背景'],
]
function testLogo(kind: TestLogo): Promise<Blob | null> {
  const c = document.createElement('canvas')
  c.width = 400
  c.height = 400
  const x = c.getContext('2d')
  if (!x) return Promise.resolve(null)
  if (kind === 'white') {
    x.fillStyle = '#ffffff'
    x.fillRect(0, 0, 400, 400)
  }
  const color = kind === 'dark' ? '#2b2420' : '#7a5c9e'
  // 丸と、肉球のような小さな丸4つ（どこにもない形。仮のもの）
  x.fillStyle = color
  x.beginPath()
  x.ellipse(200, 250, 95, 80, 0, 0, Math.PI * 2)
  x.fill()
  for (const [cx, cy] of [[95, 150], [160, 95], [240, 95], [305, 150]]) {
    x.beginPath()
    x.ellipse(cx, cy, 40, 48, 0, 0, Math.PI * 2)
    x.fill()
  }
  x.fillStyle = '#ffffff'
  x.font = 'bold 56px sans-serif'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillText('仮', 200, 255)
  return new Promise((ok) => c.toBlob((b) => ok(b), 'image/png'))
}
