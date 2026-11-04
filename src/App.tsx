import { useCallback, useEffect, useRef, useState } from 'react'
import { newCat, type Cat, type Shelter } from './types'
import * as db from './db'
import { detectBrowser, isStandalone } from './lib/browser'
import { makeFixedPost } from './lib/post'
import InstallGuide, { GUIDE_SKIPPED_KEY } from './screens/InstallGuide'
import Home from './screens/Home'
import ShelterForm from './screens/ShelterForm'
import Roster from './screens/Roster'
import CatForm from './screens/CatForm'
import Preview from './screens/Preview'
import Save from './screens/Save'

export type Screen = 'loading' | 'guide' | 'welcome' | 'home' | 'shelter' | 'roster' | 'cat' | 'preview' | 'save'

function guideSkipped(): boolean {
  try {
    return localStorage.getItem(GUIDE_SKIPPED_KEY) === '1'
  } catch {
    return false
  }
}

// 初めて開いた人に、ホーム画面に追加する案内を出すか
const needsGuide = () => detectBrowser() !== 'not-ios' && !isStandalone() && !guideSkipped()

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [error, setError] = useState('')
  const [shelter, setShelter] = useState<Shelter | null>(null)
  const [cats, setCats] = useState<Cat[]>([])
  const [cat, setCat] = useState<Cat>(newCat)
  const [fromRoster, setFromRoster] = useState(false)
  const [post, setPost] = useState('')
  const [hasDraft, setHasDraft] = useState(false)

  const go = (next: Screen) => {
    setScreen(next)
    window.scrollTo(0, 0)
  }

  // 起動：保存してある内容を読み込んでから、最初の画面を決める（読み込み前に登録画面を出さない）
  useEffect(() => {
    void db.requestPersist()
    ;(async () => {
      try {
        const [s, list, saved] = await Promise.all([db.loadShelter(), db.loadCats(), db.loadDraft()])
        setCats(list)
        if (!s) {
          setScreen(needsGuide() ? 'guide' : 'welcome')
          return
        }
        setShelter(s)
        if (saved) {
          // 入力の途中で読み込み直されたときは、その画面に戻す
          setCat({ ...saved.draft.cat, photos: saved.photos })
          setFromRoster(saved.draft.fromRoster)
          setPost(saved.draft.post)
          setHasDraft(true)
          setScreen(saved.draft.screen)
          return
        }
        setScreen('home')
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [])

  // 入力の途中を、スマホの中に自動で残す
  const editing = screen === 'cat' || screen === 'preview'
  const latest = useRef<db.Draft | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    if (latest.current) void db.saveDraft(latest.current)
  }, [])

  useEffect(() => {
    if (!editing) return
    const { photos: _photos, ...rest } = cat
    latest.current = { cat: rest, fromRoster, screen, post }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 300)
  }, [cat, fromRoster, screen, post, editing, flush])

  // 写真は大きいので、変わったときだけ書く
  useEffect(() => {
    if (editing) void db.saveDraftPhotos(cat.photos)
  }, [cat.photos, editing])

  // LINEなどに移る瞬間に、待たずに書く
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    }
  }, [flush])

  const startNew = async () => {
    if (hasDraft && !window.confirm('入力の途中の内容があります。消して、新しく始めますか？')) return
    await discardDraft()
    setCat(newCat())
    setFromRoster(false)
    setHasDraft(true)
    go('cat')
  }

  const discardDraft = async () => {
    window.clearTimeout(timer.current)
    latest.current = null
    await db.clearDraft()
    setHasDraft(false)
  }

  const pickFromRoster = async (picked: Cat) => {
    if (hasDraft && !window.confirm('入力の途中の内容があります。消して、この子を開きますか？')) return
    await discardDraft()
    setCat(picked)
    setFromRoster(true)
    setHasDraft(true)
    go('cat')
  }

  const saveShelter = async (s: Shelter) => {
    await db.saveShelter(s)
    setShelter(s)
    void db.requestPersist()
    go('home')
  }

  const saveToRoster = async () => {
    const saved = { ...cat, updatedAt: Date.now() }
    await db.saveCat(saved)
    // 先に画面を変える（入力の画面のままだと、途中の自動保存がもう一度動いてしまう）
    setCat(saved)
    go('save')
    await discardDraft()
    setCats(await db.loadCats())
  }

  const removeCat = async (id: string) => {
    await db.deleteCat(id)
    setCats(await db.loadCats())
  }

  if (error) {
    return (
      <main className="screen">
        <p className="alert">スマホの中の保存場所が開けませんでした。プライベートブラウズでは使えません。</p>
        <p className="muted">{error}</p>
      </main>
    )
  }

  const themeColor = shelter?.themeColor ?? '#e8826b'

  return (
    <div className="app" style={{ ['--theme' as string]: themeColor }}>
      {screen === 'loading' && <p className="loading">読み込み中…</p>}
      {screen === 'guide' && (
        <InstallGuide
          browser={detectBrowser()}
          onSkip={() => {
            try {
              localStorage.setItem(GUIDE_SKIPPED_KEY, '1')
            } catch {
              // 保存できなくても先へ進める
            }
            go('welcome')
          }}
        />
      )}
      {(screen === 'welcome' || screen === 'shelter') && (
        <ShelterForm
          initial={shelter}
          first={screen === 'welcome'}
          onSave={saveShelter}
          onBack={() => go('home')}
        />
      )}
      {screen === 'home' && shelter && (
        <Home
          shelter={shelter}
          catCount={cats.length}
          draftName={hasDraft ? cat.name || '名前はまだ' : null}
          onNew={startNew}
          onContinue={() => go('cat')}
          go={go}
        />
      )}
      {screen === 'roster' && (
        <Roster cats={cats} onBack={() => go('home')} onPick={pickFromRoster} onDelete={removeCat} />
      )}
      {screen === 'cat' && (
        <CatForm
          cat={cat}
          fromRoster={fromRoster}
          onChange={setCat}
          onBack={() => go('home')}
          onNext={() => {
            if (shelter) setPost(makeFixedPost(cat, shelter))
            go('preview')
          }}
        />
      )}
      {screen === 'preview' && shelter && (
        <Preview
          shelter={shelter}
          post={post}
          onPostChange={setPost}
          onBack={() => go('cat')}
          onSave={saveToRoster}
        />
      )}
      {screen === 'save' && (
        <Save cat={cat} post={post} onHome={() => go('home')} onRoster={() => go('roster')} />
      )}
    </div>
  )
}
