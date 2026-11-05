import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_VERSION, CHECK_MODE } from './lib/checkMode'
import { newCat, type AdoptionEvent, type Cat, type Shelter } from './types'
import * as db from './db'
import { detectBrowser, isStandalone } from './lib/browser'
import { makeFixedPost } from './lib/post'
import { makeCover } from './lib/shrink'
import { migrateOldCats } from './lib/migrate'
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
  const [cats, setCats] = useState<db.CatSummary[]>([]) // 一覧用（写真は持たない。選んだときに loadCat で読む）
  const [cat, setCat] = useState<Cat>(newCat)
  const [fromRoster, setFromRoster] = useState(false)
  const [post, setPost] = useState('')
  const [hasDraft, setHasDraft] = useState(false)
  const [unreadableCats, setUnreadableCats] = useState(0) // 名簿の中で、読めなかった子の数（消さずに残している）
  const [draftUnreadable, setDraftUnreadable] = useState(false) // 入力の途中が読めなかった
  const [postEdited, setPostEdited] = useState(false) // 投稿文を手で直したか
  const [autosaveFailed, setAutosaveFailed] = useState(false) // 入力の途中を残せなかった
  const [blocked, setBlocked] = useState(false) // 古い版のタブが開いていて、保存場所を開けない
  const [pickError, setPickError] = useState(false) // 名簿から選んだ子の写真が読めなかった
  const [loadMs, setLoadMs] = useState<number | null>(null) // 名簿を読むのにかかった時間（確認モードで出す）
  const [migrateFailed, setMigrateFailed] = useState(0) // 移し替えられなかった子の数（確認モードで出す）
  const migrating = useRef(false)
  const [reelEvent, setReelEvent] = useState<AdoptionEvent | null>(null) // 最後の1枚に入れる譲渡会（確認画面で選んだもの）

  const go = (next: Screen) => {
    setScreen(next)
    window.scrollTo(0, 0)
  }

  // 起動：保存してある内容を読み込んでから、最初の画面を決める（読み込み前に登録画面を出さない）
  useEffect(() => {
    db.onBlocked(setBlocked)
    void db.requestPersist()
    ;(async () => {
      try {
        // 1つずつ読む。名簿や途中の1件が読めなくても、ほかは使えるようにする（db.ts で形をそろえる）
        const s = await db.loadShelter()
        const t0 = performance.now()
        const list = await db.loadCats()
        setLoadMs(performance.now() - t0)
        const saved = await db.loadDraft()
        setCats(list.cats)
        setUnreadableCats(list.unreadable)
        // 古い形の子の移し替えは、画面を出してから、うしろで動かす（待たせない・固まらせない）
        const olds = list.cats.filter((c) => c.oldShape)
        if (olds.length > 0 && !migrating.current) {
          migrating.current = true
          setTimeout(() => {
            void migrateOldCats(olds, (p) => {
              setMigrateFailed(p.failed)
              // 終わったら一覧を読み直し、小さな表紙に替える（読めなくても、今の一覧のまま使える）
              if (p.left === 0)
                db.loadCats().then(
                  (l) => {
                    setCats(l.cats)
                    setUnreadableCats(l.unreadable)
                  },
                  () => {},
                )
            }).finally(() => {
              migrating.current = false
            })
          }, 0)
        }
        if (!s) {
          setScreen(needsGuide() ? 'guide' : 'welcome')
          return
        }
        setShelter(s)
        if (saved === 'unreadable') {
          setDraftUnreadable(true)
        } else if (saved) {
          // 入力の途中で読み込み直されたときは、その画面に戻す
          let restored = saved.cat
          if (saved.draft.fromRoster) {
            // 名簿から選んだ子は、名簿の元の写真と動画を読み直す。入力の途中には動画を残していないので、
            // そのまま保存すると名簿の動画が消えるため。途中の写真がまだ書かれていなかったときは、写真も名簿から取る
            try {
              const full = await db.loadCat(restored.id)
              restored = {
                ...restored,
                // 途中に動画が残っていれば、それを使う（外した動画が戻らないように）
                clip: saved.clipMissing ? full.clip : restored.clip,
                photos: saved.photosMissing ? full.photos : restored.photos,
              }
            } catch {
              // 名簿の写真・動画が読めないまま開くと、保存したときに名簿の写真や動画が消える。
              // 途中の写真があってもなくても開かずに、ホームで知らせる（途中は消さない）
              setDraftUnreadable(true)
              setScreen('home')
              return
            }
          }
          setCat(restored)
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

  // 動画も大きいので、変わったときだけ書く
  const clipBlob = cat.clip?.blob ?? null
  useEffect(() => {
    if (worthKeeping)
      db.saveDraftClip(clipBlob).then(
        () => setAutosaveFailed(false),
        () => setAutosaveFailed(true),
      )
  }, [clipBlob, worthKeeping])

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

  const pickFromRoster = async (picked: db.CatSummary) => {
    if (hasDraft && !window.confirm('入力の途中の内容があります。消して、この子を開きますか？')) return
    // 一覧には写真がないので、ここで元の写真を読む。読めなかったら開かない
    // （写真のないまま開いて保存すると、写真が消えてしまうため）。入力の途中も消さない
    let full: Cat
    try {
      full = await db.loadCat(picked.id)
    } catch {
      setPickError(true)
      return
    }
    setPickError(false)
    await discardDraft()
    setCat(full)
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

  // ［動画を作る］：名簿を新しくしてから、保存の画面で動画を作る（SPEC 2.5「保存したら、名簿の内容も新しくする」）
  const saveToRoster = async (event: AdoptionEvent | null) => {
    setReelEvent(event)
    const saved = { ...cat, updatedAt: Date.now() }
    // 一覧の小さな表紙を、1枚目の写真から作る（保存する写真そのものは小さくしない）
    await db.saveCat(saved, await makeCover(saved.photos[0]))
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
      {CHECK_MODE && <p className="check-mode">確認モード・版 {APP_VERSION}</p>}
      {screen === 'loading' &&
        (blocked ? (
          <p className="alert">ほかに開いているタブを閉じてください。名簿は消していません。</p>
        ) : (
          <p className="loading">読み込み中…</p>
        ))}
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
          checkLine={
            CHECK_MODE
              ? `名簿：新しい形${cats.filter((c) => !c.oldShape).length}匹・古い形${cats.filter((c) => c.oldShape).length}匹` +
                (migrateFailed ? `・移せなかった${migrateFailed}匹` : '') +
                (loadMs !== null ? `（読むのに${Math.round(loadMs)}ms）` : '')
              : null
          }
          draftUnreadable={draftUnreadable}
          storageWarning={guideSkipped() && !isStandalone() && detectBrowser() !== 'not-ios'}
          onNew={startNew}
          onContinue={() => go('cat')}
          go={go}
        />
      )}
      {screen === 'roster' && (
        <Roster
          cats={cats}
          pickError={pickError}
          onBack={() => {
            setPickError(false)
            go('home')
          }}
          onPick={pickFromRoster}
          onDelete={removeCat}
        />
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
          cat={cat}
          onCatChange={setCat}
          post={post}
          onPostChange={(p) => {
            setPost(p)
            setPostEdited(true)
          }}
          onBack={() => go('cat')}
          onSave={saveToRoster}
        />
      )}
      {screen === 'save' && shelter && (
        <Save cat={cat} shelter={shelter} event={reelEvent} post={post} onHome={() => go('home')} onRoster={() => go('roster')} />
      )}
    </div>
  )
}
