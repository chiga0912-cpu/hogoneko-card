import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_VERSION, CHECK_MODE } from './lib/checkMode'
import { newCat, type Cat, type Shelter, type ShelterEvent } from './types'
import * as db from './db'
import { detectBrowser, isStandalone } from './lib/browser'
import { makeFixedPost } from './lib/post'
import { renameInPost } from './lib/story'
import { makeCover } from './lib/shrink'
import { migrateOldCats } from './lib/migrate'
import { askConfirm, ConfirmHost } from './lib/confirm'
import { newerVersion } from './lib/update'
import type { StoryDraft } from './lib/story'
import InstallGuide, { GUIDE_SKIPPED_KEY } from './screens/InstallGuide'
import Home from './screens/Home'
import ShelterForm from './screens/ShelterForm'
import Roster from './screens/Roster'
import CatForm from './screens/CatForm'
import Preview from './screens/Preview'
import Save from './screens/Save'
import { themeInk } from './lib/themeInk'
import { saveAsk } from './lib/askState'

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

// 名簿から開いたときと同じか（写真・動画は同じものか、文字や選んだボタンは同じか）。issue #42
const sameCat = (a: Cat, b: Cat) => {
  const { photos: pa, clip: ca, updatedAt: _ua, ...ra } = a
  const { photos: pb, clip: cb, updatedAt: _ub, ...rb } = b
  return (
    pa.length === pb.length &&
    pa.every((p, i) => p === pb[i]) &&
    (ca?.blob ?? null) === (cb?.blob ?? null) &&
    (ca?.start ?? 0) === (cb?.start ?? 0) &&
    (ca?.length ?? 0) === (cb?.length ?? 0) &&
    JSON.stringify(ra) === JSON.stringify(rb)
  )
}

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
  const [openedAs, setOpenedAs] = useState<Cat | null>(null) // 名簿から開いたときの内容（何か変えたかを見るため。#42）
  const [post, setPost] = useState('')
  const [hasDraft, setHasDraft] = useState(false)
  const [unreadableCats, setUnreadableCats] = useState(0) // 名簿の中で、読めなかった子の数（消さずに残している）
  const [draftUnreadable, setDraftUnreadable] = useState(false) // 入力の途中が読めなかった
  const [postEdited, setPostEdited] = useState(false) // 投稿文を手で直したか
  const [story, setStory] = useState<StoryDraft | null>(null) // Claudeが書いた本文と根拠の確認の結果（#17）
  // 今の入力（本文が届いたときに、書き始めたときではなく今の入力で投稿文を組み立てるため。#23のあとの見直しの重い1）
  const live = useRef({ cat, post, postEdited, shelter })
  live.current = { cat, post, postEdited, shelter }
  // 確認画面を離れたときの名前（投稿文に決まった文がないときに、名前を変えたかを知るため。見直しの重い1）
  const leftPreviewName = useRef<string | null>(null)
  // 入力の途中を残せなかった（文字・写真・動画で分けて持つ。1つが成功しても、ほかの失敗の知らせを消さないため）
  const [saveFail, setSaveFail] = useState({ text: false, photos: false, clip: false })
  const setFail = (k: 'text' | 'photos' | 'clip', v: boolean) => setSaveFail((f) => (f[k] === v ? f : { ...f, [k]: v }))
  const autosaveFailed = saveFail.text || saveFail.photos || saveFail.clip
  const [blocked, setBlocked] = useState(false) // 古い版のタブが開いていて、保存場所を開けない
  const [pickError, setPickError] = useState(false) // 名簿から選んだ子の写真が読めなかった
  const [loadMs, setLoadMs] = useState<number | null>(null) // 名簿を読むのにかかった時間（確認モードで出す）
  const [migrateFailed, setMigrateFailed] = useState(0) // 移し替えられなかった子の数（確認モードで出す）
  const migrating = useRef(false)
  // 団体名が空のまま残っている（前の版で作ったデータなど）。シェルター情報を先に出し、入れるまでほかの画面へ進ませない（11/6 作者の決定・案1）
  // 入れたあとは、本当は開くはずだった画面（入力の途中ならその画面）へ進む
  const [needName, setNeedName] = useState<Screen | null>(null)
  const [clipLost, setClipLost] = useState(false) // 途中の動画を残せていなかった
  const [stalePhotos, setStalePhotos] = useState<Blob[] | null>(null) // 前の写真の組に戻っているかもしれないとき、その組（#44）
  const [reelWords, setReelWords] = useState<string | null>(null) // ひとことカードに載せる文（確認画面で決めたもの）
  const [reelEvent, setReelEvent] = useState<ShelterEvent | null>(null) // 最後の1枚に入れる譲渡会（確認画面で選んだもの）

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
        // 団体名が空なら、途中も名簿も消さずに読み込んだうえで、シェルター情報を先に出す
        const nameMissing = !s.name.trim()
        const open = (next: Screen) => {
          if (nameMissing) {
            setNeedName(next)
            setScreen('shelter')
          } else setScreen(next)
        }
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
                // 途中に動画が残っていれば、それを使う（外した・替えた動画が戻らないように）
                clip:
                  saved.clipStatus === 'old'
                    ? full.clip
                    : saved.clipStatus === 'roster' && full.clip
                      ? { ...full.clip, ...saved.clipRange }
                      : restored.clip,
                // 名簿の写真から作り直すときは、名簿の何枚目をどの順で使っていたかを使う（外した・並べ替えたまま。見直し③の重い2）
                photos:
                  saved.photosStatus === 'missing' || saved.photosStatus === 'roster'
                    ? saved.photosRosterIdx
                      ? saved.photosRosterIdx.map((i) => full.photos[i]).filter((b): b is Blob => !!b)
                      : full.photos
                    : restored.photos,
              }
            } catch {
              // 名簿の写真・動画が読めないまま開くと、保存したときに名簿の写真や動画が消える。
              // 途中の写真があってもなくても開かずに、ホームで知らせる（途中は消さない）
              setDraftUnreadable(true)
              open('home')
              return
            }
          }
          // 選び直した動画を書き終える前にページが終わったときは、黙って名簿の動画に戻さず、知らせる
          if (saved.clipStatus === 'lost') setClipLost(true)
          // 選び直した写真を書き終える前にページが終わったときは、前の写真のまま開き、黙らずに知らせる（#44）
          if (saved.photosStatus === 'stale') setStalePhotos(restored.photos)
          setCat(restored)
          setFromRoster(saved.draft.fromRoster)
          setPost(saved.draft.post)
          setPostEdited(saved.draft.postEdited)
          setStory(saved.draft.story ?? null)
          setHasDraft(true)
          open(saved.draft.screen)
          return
        }
        open('home')
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
        () => setFail('text', false),
        () => setFail('text', true),
      )
  }, [])

  // 何か1つでも入れたときだけ「入力の途中」として残す。
  // 名簿から選んだ子は、開いたあとに何か1つでも変えたときだけ（何も変えずに戻ったら、「入力の続き」も確認も出さない。SPEC 2.7・#42）。
  // 入力の途中から開き直した名簿の子（openedAs がない）は、もう変えてあるので残す
  const rosterChanged = fromRoster && (openedAs === null || postEdited || !sameCat(cat, openedAs))
  const worthKeeping = editing && (fromRoster ? rosterChanged : hasContent(cat))
  useEffect(() => {
    if (!worthKeeping) return
    const { photos: _photos, ...rest } = cat
    latest.current = {
      cat: rest,
      fromRoster,
      screen: screen as 'cat' | 'preview',
      post,
      postEdited,
      story,
      photosKey: db.photosKeyOf(cat.photos),
      photosRosterIdx: db.photosRosterIdxOf(cat.photos),
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 300)
  }, [cat, fromRoster, screen, post, postEdited, story, worthKeeping, flush])

  // 写真は大きいので、変わったときだけ書く
  useEffect(() => {
    if (worthKeeping)
      db.saveDraftPhotos(cat.photos).then(
        () => setFail('photos', false),
        () => setFail('photos', true),
      )
  }, [cat.photos, worthKeeping])

  // 動画も大きいので、変わったときだけ書く
  const clipBlob = cat.clip?.blob ?? null
  useEffect(() => {
    if (worthKeeping)
      // 動画の中身は、動画が変わったときだけ書く（始まり・長さは文字の記録に入る。ここで渡すのは、選び直した直後に閉じたときのため）
      db.saveDraftClip(cat.clip).then(
        () => setFail('clip', false),
        () => setFail('clip', true),
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 新しい版の知らせ（SPEC 2.9）。アプリに戻ってきたとき・開いたとき・開いている間は5分ごとに確かめる。
  // 勝手には読み込み直さない（動画を作っている途中などで止めないため）。押したら、入力の途中を書いてから読み込み直す
  const [update, setUpdate] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    const check = () => {
      if (document.visibilityState !== 'visible') return
      void newerVersion().then((v) => {
        if (!stop && v) setUpdate(v)
      })
    }
    const first = window.setTimeout(check, 1500)
    const every = window.setInterval(check, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      stop = true
      window.clearTimeout(first)
      window.clearInterval(every)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])
  const reloadNow = async () => {
    window.clearTimeout(timer.current)
    if (latest.current) await db.saveDraft(latest.current).catch(() => {})
    window.location.reload()
  }

  const startNew = async () => {
    if (hasDraft && !(await askConfirm('入力の途中の内容があります。消して、新しく始めますか？', { yes: '消して新しく始める' }))) return
    await discardDraft()
    setCat(newCat())
    setFromRoster(false)
    setPost('')
    setPostEdited(false)
    setStory(null)
    go('cat')
  }

  // keepAsk：名簿の子を開くときは、聞き返しの下書きを消さない（下書きはメモで見分けるので、同じ子を開き直せば続きが出る。見直しの4）
  const discardDraft = async (keepAsk = false) => {
    window.clearTimeout(timer.current)
    latest.current = null
    setHasDraft(false)
    setDraftUnreadable(false)
    if (!keepAsk) saveAsk(null) // 聞き返しの下書きも消す（#18）
    await db.clearDraft()
  }

  const pickFromRoster = async (picked: db.CatSummary) => {
    if (hasDraft && !(await askConfirm('入力の途中の内容があります。消して、この子を開きますか？', { yes: '消してこの子を開く' }))) return
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
    await discardDraft(true)
    setCat(full)
    setOpenedAs(full)
    setFromRoster(true)
    setPost('')
    setPostEdited(false)
    setStory(null)
    go('cat')
  }

  // 保存に失敗したら、呼んだ画面で知らせる（ここでは受け止めない）
  const saveShelter = async (s: Shelter) => {
    await db.saveShelter(s)
    setShelter(s)
    void db.requestPersist()
    const next = needName ?? 'home'
    setNeedName(null)
    go(next)
  }

  // ［動画を作る］：名簿を新しくしてから、保存の画面で動画を作る（SPEC 2.5「保存したら、名簿の内容も新しくする」）
  const saveToRoster = async (event: ShelterEvent | null, words: string | null) => {
    setReelEvent(event)
    setReelWords(words)
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
  // 画面の文字・ボタンには、テーマ色を読める濃さにした色を使う（入力された色とカードの帯は変えない。11/7）
  const ink = themeInk(themeColor)

  return (
    <div className="app" style={{ ['--theme' as string]: themeColor, ['--theme-text' as string]: ink.text, ['--theme-strong' as string]: ink.strong, ['--on-theme' as string]: ink.on }}>
      {CHECK_MODE && <p className="check-mode">確認モード・版 {APP_VERSION}</p>}
      {update && (
        <div className="update-bar" role="status">
          <p>新しい版があります。</p>
          <button className="btn btn-small btn-primary" onClick={() => void reloadNow()}>
            読み込み直す
          </button>
        </div>
      )}
      <ConfirmHost />
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
          needName={!!needName && screen === 'shelter'}
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
          onNext={async () => {
            if (shelter) {
              const fresh = makeFixedPost(cat, shelter)
              // 手で直した投稿文は、黙って作り直さない（二度書かせないため）
              // Claudeの本文で作った投稿文のまま（手で直していない）なら、本文と確認の結果を残したまま、入力の内容で作り直す（見直しの中9）
              if (!postEdited && story) {
                setPost(makeFixedPost(cat, shelter, new Date(), story.result.body))
              } else if (
                !postEdited ||
                post === fresh ||
                (await askConfirm('投稿文を手で直しています。入力の内容で作り直しますか？\n（作り直すと、直した文は消えます）', {
                  yes: '作り直す',
                  no: '直した文のまま',
                }))
              ) {
                setPost(fresh)
                setPostEdited(false)
                setStory(null) // 投稿文を作り直したので、前の本文の確認の結果は使わない
              } else {
                // 手で直した投稿文のままでも、頭の【名前】と最後の決まった文は今の名前にする（11/7 作者の決定）
                setPost(renameInPost(post, cat.name, cat.id, leftPreviewName.current ?? undefined))
              }
            }
            go('preview')
          }}
          autosaveFailed={autosaveFailed}
          clipLost={clipLost && !cat.clip} // 選び直したら知らせを消す
          photosStale={stalePhotos !== null && cat.photos === stalePhotos} // 写真を選び直したら知らせを消す
        />
      )}
      {screen === 'preview' && shelter && (
        <Preview
          shelter={shelter}
          cat={cat}
          // 確認画面で開き直したときも、写真・動画が前のものに戻ったかもしれないことを知らせる（見直し③の中5）
          restoreNotice={
            stalePhotos !== null && cat.photos === stalePhotos
              ? '写真が、前に選んだものに戻っているかもしれません。［戻る］で写真を確かめてください。'
              : clipLost && !cat.clip
                ? '選んだ動画を残せていませんでした。［戻る］で、もう一度、動画を選んでください。'
                : null
          }
          onCatChange={setCat}
          post={post}
          onPostChange={(p) => {
            setPost(p)
            setPostEdited(true)
          }}
          story={story}
          onStoryChange={setStory}
          live={() => live.current}
          onStoryPost={(p) => {
            setPost(p)
            setPostEdited(false)
          }}
          onBack={() => {
            leftPreviewName.current = cat.name
            go('cat')
          }}
          onSave={saveToRoster}
        />
      )}
      {screen === 'save' && shelter && (
        <Save
          cat={cat}
          shelter={shelter}
          event={reelEvent}
          words={reelWords}
          post={post}
          onHome={() => go('home')}
          onRoster={() => go('roster')}
          // 作れなかったとき・位置情報があったときは、入力も投稿文もそのままで確認画面に戻る（もう一度書かせないため）
          onBackToPreview={() => {
            setFromRoster(true) // 名簿に保存したあとなので、名簿の子として開き直す
            setOpenedAs(null) // 作る途中なので、入力の途中として残す
            go('preview')
          }}
        />
      )}
    </div>
  )
}
