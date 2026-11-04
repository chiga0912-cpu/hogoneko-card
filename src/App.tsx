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

// 何か1つでも入れたか（開いてすぐ戻っただけなら「入力の途中」にしない）
const hasContent = (c: Cat) => {
  const blank = '未確認'
  return (
    c.photos.length > 0 ||
    c.clip !== null ||
    c.name.trim() !== '' ||
    c.memo.trim() !== '' ||
    c.goodPoints.length > 0 ||
    c.carerWords.trim() !== '' ||
    c.age.mode !== 'unknown' ||
    c.sex !== blank ||
    c.vaccine.value !== blank ||
    c.neuter.value !== blank ||
    c.virusTest.value !== blank
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [error, setError] = useState('')
  const [shelter, setShelter] = useState<Shelter | null>(null)
  const [cats, setCats] = useState<Cat[]>([])
  const [cat, setCat] = useState<Cat>(newCat)
  const [fromRoster, setFromRoster] = useState(false)
  const [post, setPost] = useState('')
  const [hasDraft, setHasDraft] = useState(false)
  const [unreadableCats, setUnreadableCats] = useState(0) // 名簿の中で、読めなかった子の数（消さずに残している）
  const [draftUnreadable, setDraftUnreadable] = useState(false) // 入力の途中が読めなかった
  const [postEdited, setPostEdited] = useState(false) // 投稿文を手で直したか
  const [autosaveFailed, setAutosaveFailed] = useState(false) // 入力の途中を残せなかった

  const go = (next: Screen) => {
    setScreen(next)
    window.scrollTo(0, 0)
  }

  // 起動：保存してある内容を読み込んでから、最初の画面を決める（読み込み前に登録画面を出さない）
  useEffect(() => {
    void db.requestPersist()
    ;(async () => {
      try {
        // 1つずつ読む。名簿や途中の1件が読めなくても、ほかは使えるようにする（db.ts で形をそろえる）
        const s = await db.loadShelter()
        const list = await db.loadCats()
        const saved = await db.loadDraft()
        setCats(list.cats)
        setUnreadableCats(list.unreadable)
        if (!s) {
          setScreen(needsGuide() ? 'guide' : 'welcome')
          return
        }
        setShelter(s)
        if (saved === 'unreadable') {
          setDraftUnreadable(true)
        } else if (saved) {
          // 入力の途中で読み込み直されたときは、その画面に戻す
          setCat(saved.cat)
          setFromRoster(saved.draft.fromRoster)
          setPost(saved.draft.post)
          setPostEdited(saved.draft.postEdited)
          setHasDraft(true)
          setScreen(saved.draft.screen)
          return
        }
        setScreen('home')
      } catch (e) {
        setError(e instanceof db.OpenError ? 'open' : String(e))
      }
    })()
  }, [])

  // 入力の途中を、スマホの中に自動で残す
  const editing = screen === 'cat' || screen === 'preview'
  const latest = useRef<db.Draft | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    if (!latest.current) return
    setHasDraft(true)
    db.saveDraft(latest.current).then(
        () => setAutosaveFailed(false),
        () => setAutosaveFailed(true),
      )
  }, [])

  // 名簿から選んだ子か、何か1つでも入れたときだけ「入力の途中」として残す
  const worthKeeping = editing && (fromRoster || hasContent(cat))
  useEffect(() => {
    if (!worthKeeping) return
    const { photos: _photos, ...rest } = cat
    latest.current = { cat: rest, fromRoster, screen: screen as 'cat' | 'preview', post, postEdited }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 300)
  }, [cat, fromRoster, screen, post, postEdited, worthKeeping, flush])

  // 写真は大きいので、変わったときだけ書く
  useEffect(() => {
    if (worthKeeping)
      db.saveDraftPhotos(cat.photos).then(
        () => setAutosaveFailed(false),
        () => setAutosaveFailed(true),
      )
  }, [cat.photos, worthKeeping])

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
    setPost('')
    setPostEdited(false)
    go('cat')
  }

  const discardDraft = async () => {
    window.clearTimeout(timer.current)
    latest.current = null
    setHasDraft(false)
    setDraftUnreadable(false)
    await db.clearDraft()
  }

  const pickFromRoster = async (picked: Cat) => {
    if (hasDraft && !window.confirm('入力の途中の内容があります。消して、この子を開きますか？')) return
    await discardDraft()
    setCat(picked)
    setFromRoster(true)
    setPost('')
    setPostEdited(false)
    go('cat')
  }

  // 保存に失敗したら、呼んだ画面で知らせる（ここでは受け止めない）
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
    await reloadCats()
  }

  const reloadCats = async () => {
    const list = await db.loadCats()
    setCats(list.cats)
    setUnreadableCats(list.unreadable)
  }

  const removeCat = async (id: string) => {
    await db.deleteCat(id)
    await reloadCats()
  }

  if (error) {
    // 理由と違う知らせを出さない。名簿は消していないことを伝える
    return (
      <main className="screen">
        {error === 'open' ? (
          <p className="alert">
            スマホの中の保存場所が開けませんでした。名簿は消していません。アプリを閉じて、開き直してください。
          </p>
        ) : (
          <p className="alert">
            保存してある内容を読み込めませんでした。名簿は消していません。アプリを閉じて、開き直してください。
          </p>
        )}
        {error !== 'open' && <p className="muted">{error}</p>}
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
          unreadableCats={unreadableCats}
          draftUnreadable={draftUnreadable}
          storageWarning={guideSkipped() && !isStandalone() && detectBrowser() !== 'not-ios'}
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
            if (shelter) {
              const fresh = makeFixedPost(cat, shelter)
              // 手で直した投稿文は、黙って作り直さない（二度書かせないため）
              if (
                !postEdited ||
                post === fresh ||
                window.confirm('投稿文を手で直しています。入力の内容で作り直しますか？\n（作り直すと、直した文は消えます）')
              ) {
                setPost(fresh)
                setPostEdited(false)
              }
            }
            go('preview')
          }}
          autosaveFailed={autosaveFailed}
        />
      )}
      {screen === 'preview' && shelter && (
        <Preview
          shelter={shelter}
          post={post}
          onPostChange={(p) => {
            setPost(p)
            setPostEdited(true)
          }}
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
