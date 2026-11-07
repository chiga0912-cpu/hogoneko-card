import { callClaude, limitText } from '../lib/claude'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_HASHTAGS, type AdoptionEvent, type Cat, type Shelter } from '../types'
import { countHashtags } from '../lib/hashtags'
import {
  CARD_H,
  CARD_W,
  drawCatCard,
  drawCoverCard,
  drawEndCard,
  drawWordsCard,
  loadImage,
  splitSentences,
  type CardLayout,
  type Framing,
  type TextPosition,
} from '../lib/card'
import * as db from '../db'
import { nextEvent } from '../lib/events'
import WriteStory, { type Live } from './WriteStory'
import StoryCheck, { openFlags, type CheckState } from './StoryCheck'
import { factChunks, flagOldName, removeSentence, splitMemo, storySentences, writtenNameOf, type StoryDraft, type Verdict } from '../lib/story'
import { makeFixedPost } from '../lib/post'
import { flushTyped } from '../lib/typed'
import { askConfirm } from '../lib/confirm'
import { loadBandPattern } from '../lib/band'
import { cardProfile } from '../lib/age'
import { clipTimeFor, photoIndex, type CardKey } from '../lib/photoPlan'
import { TopBar } from './ShelterForm'
import FramingEditor from './FramingEditor'
import WordIdeas from './WordIdeas'
import { addSwap, cardSwaps, cardWordLines, removeSwap } from '../lib/words'
import { fullMemo } from '../lib/ask'
import { cleanLine } from '../lib/lineText'
import { maskContacts } from '../lib/extract'

const POSITIONS: [TextPosition, string][] = [
  ['up', '少し上'],
  ['normal', 'ふつう'],
  ['down', '少し下'],
]

// 猫カード（SPEC 3.2 の3番目）。写真はスマホの中で描くだけ
function CatCard({
  cat,
  shelter,
  className,
  onLayout,
  onClick,
  still = null,
  avoid = null,
}: {
  cat: Cat
  shelter: Shelter
  avoid?: string | null // ひとことカードに載せる文（同じ行は猫カードの言葉に使わない）
  className: string
  onLayout?: (l: CardLayout) => void
  onClick: () => void
  still?: HTMLCanvasElement | null // 写真がなく動画だけのときの、選んだ5秒の最初のコマ
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [layout, setLayout] = useState<CardLayout | null>(null)
  // 猫カードは写真の2枚目、なければ1枚目（SPEC 3.2）
  const photoBlob = cat.photos[1] ?? cat.photos[0] ?? null
  useEffect(() => {
    let stop = false
    ;(async () => {
      const [photo, logo, pattern] = await Promise.all([
        photoBlob ? loadImage(photoBlob).catch(() => null) : null,
        shelter.logo ? loadImage(shelter.logo).catch(() => null) : null,
        loadBandPattern(),
      ])
      const ctx = ref.current?.getContext('2d')
      if (stop || !ctx) return
      const l = drawCatCard(ctx, {
        photo: photo ?? still,
        logo,
        name: cat.name,
        profile: cardProfile(cat.age, cat.sex),
        lines: cardWordLines(cat.goodPoints, cat.cardLines), // 選んだ短い言葉の案があれば、その行だけ案に（#19）
        avoid,
        theme: shelter.themeColor,
        position: cat.textPosition,
        framing: cat.framing.cat,
        pattern,
      })
      setLayout(l)
      onLayout?.(l)
    })()
    return () => {
      stop = true
    }
  }, [photoBlob, still, shelter.logo, shelter.themeColor, cat.name, cat.age, cat.sex, cat.goodPoints, cat.cardLines, avoid, cat.textPosition, cat.framing.cat, onLayout])
  return (
    <canvas
      ref={ref}
      width={CARD_W}
      height={CARD_H}
      className={className}
      onClick={onClick}
      data-drawn={layout ? '1' : '0'}
      data-fits={layout?.fits ? '1' : '0'}
      data-scale={layout?.scale}
      data-lines-shown={layout?.linesShown}
      data-lines-total={layout?.linesTotal}
      data-word={layout?.word ?? ''}
      data-word-rows={layout?.wordRows}
      data-contrast={layout?.contrast}
      data-design={layout?.design}
      data-darken={layout?.darken}
      aria-label="猫カード（押すと画面いっぱいに出ます）"
    />
  )
}

// 表紙・最後の1枚（写真はスマホの中で描くだけ）
type Painter = (ctx: CanvasRenderingContext2D) => Promise<Record<string, string | number | boolean>>
function PaintedCard({ paint, deps, className, label, onClick }: { paint: Painter; deps: unknown[]; className: string; label: string; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [info, setInfo] = useState<Record<string, string | number | boolean> | null>(null)
  useEffect(() => {
    let stop = false
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    paint(ctx).then((i) => {
      if (!stop) setInfo(i)
    })
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  const data = Object.fromEntries(Object.entries(info ?? {}).map(([k, v]) => [`data-${k}`, String(v === true ? 1 : v === false ? 0 : v)]))
  return <canvas ref={ref} width={CARD_W} height={CARD_H} className={className} onClick={onClick} data-drawn={info ? '1' : '0'} {...data} aria-label={label} />
}

type Props = {
  shelter: Shelter
  cat: Cat
  onCatChange: (update: (c: Cat) => Cat) => void
  post: string
  onPostChange: (s: string) => void
  onBack: () => void
  onSave: (event: AdoptionEvent | null, words: string | null) => Promise<void>
  restoreNotice?: string | null
  story?: StoryDraft | null // Claudeが書いた本文と根拠の確認の結果（#17。入力の途中に残る）
  onStoryChange?: (s: StoryDraft | null | ((cur: StoryDraft | null) => StoryDraft | null)) => void
  onStoryPost?: (p: string) => void // Claudeの本文で作った投稿文（手で直したことにしない。見直しの中9）
  live?: () => Live // 今の入力（本文が届いたときに使う。#23のあとの見直しの重い1）
}

// 確認（仮）。カードと根拠の印は11/5〜11/6に作る。今は決まった形の投稿文だけ
export default function Preview({ shelter, cat, onCatChange, post, onPostChange, onBack, onSave, restoreNotice, story = null, onStoryChange = () => {}, onStoryPost, live }: Props) {
  // ── 根拠の確認（#17。SPEC 2.4・4.2）──
  // 本文を書いたら続けて確かめる。確かめている途中・失敗はこの画面の中だけ（入力の途中には、確認が終わったものだけ残す）
  const [checking, setChecking] = useState<'idle' | 'checking' | 'failed'>('idle')
  const [checkLimit, setCheckLimit] = useState<string | null>(null) // 回数の上限の文（#20）
  const latestStory = useRef(story)
  latestStory.current = story
  // 今のメモ（元のメモ＋足した返事・質問）を、本文を書くときと同じ形（履歴の形を整え、連絡先を伏せる）にしたもの
  const memoNow = useMemo(() => maskContacts(cleanLine(fullMemo(cat)).text).text, [cat.memo, cat.memoAdditions]) // eslint-disable-line react-hooks/exhaustive-deps
  // 本文を確かめたときのメモと、今のメモが違うか（#23 重い1。作者の決定 11/7）。違えば ✓ を消し、確かめ直すまで［動画を作る］を押せなくする
  // 比べるのは区切ったかたまり（空行・空白の違いだけなら、同じとみなす）
  // 名前・「いいところ」（確認した項目）が変わったときも同じ（11/7 作者の決定。案B）。比べるのは確認した項目のかたまり（前後の空白・空の行は同じとみなす）
  const factsNow = useMemo(() => factChunks({ name: cat.name, goodPoints: cat.goodPoints }), [cat.name, cat.goodPoints])
  const memoChanged = !!story && JSON.stringify(story.result.memoChunks) !== JSON.stringify(splitMemo(memoNow))
  const factsChanged = !!story && JSON.stringify(story.result.factChunks) !== JSON.stringify(factsNow)
  const memoStale = memoChanged || factsChanged
  const runCheck = async (s: StoryDraft) => {
    setChecking('checking')
    setCheckLimit(null)
    const sentences = storySentences(s.result.body)
    const facts = { name: cat.name, goodPoints: cat.goodPoints }
    const sentMemo = memoNow // 確かめるのは、いつも今のメモで（メモが変わったあとの確かめ直しも同じ）
    const sentCheck = s.check // 確かめ始めたときの結果（初めては null）
    try {
      const ans = await callClaude<{ results?: Verdict[] }>('/api/check', { memo: sentMemo, facts, sentences })
      if (!ans.ok && latestStory.current?.result.body === s.result.body) setCheckLimit(limitText(ans.error))
      if (!ans.ok || !Array.isArray(ans.body.results) || ans.body.results.length !== sentences.length) throw new Error('check')
      // 名前を変えたあと、本文に前の名前が残っている文は、確認役の答えにかかわらず印を付ける（11/7 作者の決定）
      const results = flagOldName(sentences, ans.body.results, writtenNameOf(s.result), facts.name)
      const memoChunks = splitMemo(sentMemo)
      const facChunks = factChunks(facts)
      // 今の本文（入力の途中にある、画面の外の値）が、確かめた本文と同じで、確かめ始めたときから結果が変わっていないときだけ入れる。
      // 確かめている間に本文が替わった・別の子になった・「残す」を選んだなら、古い結果は使わない（見直しの重い1）
      // メモが変わっていたら、確かめたメモに入れかえる。本文を書いたときの根拠の位置（parts の引用）は古いメモの番号なので外す
      // ［消す］で消した文は、確かめ直しても消したまま（kept＝［本当です（残す）］は、新しいメモでもう一度選んでもらう）
      onStoryChange((cur) => {
        if (!cur || cur.result.body !== s.result.body || cur.check !== sentCheck) return cur
        const same = JSON.stringify(cur.result.memoChunks) === JSON.stringify(memoChunks) && JSON.stringify(cur.result.factChunks) === JSON.stringify(facChunks)
        const result = same ? cur.result : { ...cur.result, memoChunks, factChunks: facChunks, parts: cur.result.parts.map((p) => ({ ...p, cites: [] })) }
        return { result, check: { sentences, verdicts: results, kept: [], removed: sentCheck?.removed ?? [] } }
      })
      if (latestStory.current?.result.body === s.result.body) setChecking('idle')
    } catch {
      if (latestStory.current?.result.body === s.result.body) setChecking('failed')
    }
  }
  // 本文が投稿文に残っているか（手で全部消したり、作り直したりしたら、確認はもう要らない）
  // 本文がある間は、確認が終わり、印の文をすべて人が片づけるまで押せない（SPEC 2.4）。
  // 印の文を手で直して文字が変わっても、印は消えない（［本当です（残す）］か、本文を外すまで。見直しの重い3・4。作者に聞くまでの安全な形）
  const storyInPost = !!story
  // メモがあって、本文をまだ書いていない（投稿文は決まった形の下書き）。［物語の本文を書いてもらう］を目立たせ、下書きだと知らせる（11/7 作者の要望）
  const draftOnly = !story && fullMemo(cat).trim() !== ''
  const checkState: CheckState =
    checking === 'checking'
      ? { status: 'checking' }
      : memoStale
        ? { status: 'stale', what: memoChanged ? 'memo' : 'facts', failed: checking === 'failed', limit: checking === 'failed' ? checkLimit : null }
        : story?.check
          ? { status: 'done', ...story.check }
          : { status: 'failed', limit: checkLimit }
  const flags = storyInPost ? openFlags(checkState, post) : []
  const storyBlocked = storyInPost && (checkState.status !== 'done' || flags.length > 0)

  const [full, setFull] = useState<'cover' | 'cat' | 'words' | 'end' | null>(null)
  const [layout, setLayout] = useState<CardLayout | null>(null)
  const [event, setEvent] = useState<AdoptionEvent | null>(null)
  const [eventsRead, setEventsRead] = useState(false) // 譲渡会を読み終えるまで［動画を作る］を押せなくする（読み終える前だと譲渡会なしで作られるため）
  const [coverFits, setCoverFits] = useState(true)
  const [endFits, setEndFits] = useState(true)
  // ひとこと・最後の1枚の形（縦の写真＝A なら写真を指で動かせる。横・正方形＝B は帯のあいだに全体を入れるので動かさない）
  const [wordsDesign, setWordsDesign] = useState<'A' | 'B'>('A')
  const [endDesign, setEndDesign] = useState<'A' | 'B'>('A')
  const [showEvent, setShowEvent] = useState(true) // 最後の1枚に譲渡会を入れるか（確認画面で外せる）
  useEffect(() => {
    db.loadEvents().then(
      (list) => {
        setEvent(nextEvent(list))
        setEventsRead(true)
      },
      () => {
        setEvent(null) // 読めなくても、連絡先だけで作れる
        setEventsRead(true)
      },
    )
  }, [])
  const photo1 = cat.photos[0] ?? null
  // 写真がなく動画だけのときは、選んだ5秒のコマを使う（SPEC 3.2 の表。表紙・猫カードは最初、ひとことはまん中、最後の1枚は最後）
  const [stills, setStills] = useState<Partial<Record<CardKey, HTMLCanvasElement | null>>>({})
  const still = stills.cover ?? null
  const clipBlob = !photo1 ? (cat.clip?.blob ?? null) : null
  const clipStart = cat.clip?.start ?? 0
  const clipLength = cat.clip?.length ?? 5
  useEffect(() => {
    if (!clipBlob) return
    let stop = false
    // 動画の部品は大きいので、使うときだけ読み込む
    import('../lib/video').then(async ({ clipFrame }) => {
      const range = { start: clipStart, length: clipLength }
      const got: Partial<Record<CardKey, HTMLCanvasElement | null>> = {}
      for (const key of ['cover', 'words', 'end'] as const) got[key] = await clipFrame(clipBlob, clipTimeFor(range, key))
      if (!stop) setStills(got)
    })
    return () => {
      stop = true
    }
  }, [clipBlob, clipStart, clipLength])
  // ひとことカード・最後の1枚の写真（SPEC 3.2 の表）
  const blobFor = (key: CardKey) => {
    const i = photoIndex(cat.photos.length, key)
    return i === null ? null : (cat.photos[i] ?? null)
  }
  const wordsBlob = blobFor('words')
  const endBlob = blobFor('end')
  const photoFor = async (key: CardKey, blob: Blob | null) => (blob ? await loadImage(blob).catch(() => null) : clipBlob ? (stills[key] ?? null) : null)
  const paintCover: Painter = async (ctx) => {
    const [photo, logo, pattern] = await Promise.all([
      photo1 ? loadImage(photo1).catch(() => null) : null,
      shelter.logo ? loadImage(shelter.logo).catch(() => null) : null,
      loadBandPattern(),
    ])
    const l = drawCoverCard(ctx, { photo: photo ?? (clipBlob ? still : null), logo, name: cat.name, theme: shelter.themeColor, shelterName: shelter.name, pattern })
    setCoverFits(l.fits)
    return { fits: l.fits, design: l.design, contrast: l.contrast, mark: l.mark, markbottom: l.markBottom }
  }
  const usedEvent = showEvent ? event : null
  const paintEnd: Painter = async (ctx) => {
    const [logo, photo, pattern] = await Promise.all([shelter.logo ? loadImage(shelter.logo).catch(() => null) : null, photoFor('end', endBlob), loadBandPattern()])
    const l = drawEndCard(ctx, { logo, shelterName: shelter.name, contact: shelter.contact, event: usedEvent, theme: shelter.themeColor, photo, framing: cat.framing.end, pattern })
    setEndFits(l.fits)
    setEndDesign(l.design)
    return { fits: l.fits, scale: l.scale, event: l.hasEvent, design: l.design, contrast: l.contrast, contact: l.contactPx, top: l.textTop, photo: photoIndex(cat.photos.length, 'end') ?? (clipBlob ? 'clip' : 'none') }
  }
  const coverDeps = [photo1, still, clipBlob, shelter.logo, shelter.themeColor, shelter.name, cat.name]
  const endDeps = [shelter.logo, shelter.name, shelter.contact, shelter.themeColor, usedEvent, endBlob, stills, cat.framing.end]

  // ひとことカード（#28）。書き換えずに載せる。入りきらないときは知らせて、投稿文にだけ載せるか、載せる文を選んでもらう（SPEC 3.2）。
  // 選んだ文は名簿に残さない（作る人の決定。11/5夜）
  const words = cat.carerWords.trim()
  const sentences = useMemo(() => splitSentences(words), [words])
  const [picked, setPicked] = useState<number[] | null>(null) // null＝全部
  const [pickFor, setPickFor] = useState(words) // ひとことが変わったら、選び直す
  if (pickFor !== words) {
    setPickFor(words)
    setPicked(null)
  }
  const pickedText = (idx: number[]) =>
    idx
      .slice()
      .sort((a, b) => a - b)
      .map((i) => sentences[i].replace(/\n$/, ''))
      .reduce((acc, s, k, arr) => (k === 0 ? s : acc + (/[。！？!?」』）)]$/.test(arr[k - 1]) ? '' : '\n') + s), '')
  const fitsText = (t: string) => {
    const c = document.createElement('canvas')
    c.width = CARD_W
    c.height = CARD_H
    const ctx = c.getContext('2d')
    return ctx ? drawWordsCard(ctx, { text: t, theme: shelter.themeColor }).fits : true
  }
  const wholeFits = useMemo(() => (words ? fitsText(words) : true), [words, shelter.themeColor]) // eslint-disable-line react-hooks/exhaustive-deps
  const wordsText = !words ? null : picked === null ? (wholeFits ? words : null) : picked.length ? pickedText(picked) : null
  const pickedFits = useMemo(() => (wordsText && picked !== null ? fitsText(wordsText) : true), [wordsText, picked]) // eslint-disable-line react-hooks/exhaustive-deps
  const wordsOnCard = wordsText !== null && pickedFits ? wordsText : null
  const paintWords: Painter = async (ctx) => {
    const [photo, pattern] = await Promise.all([photoFor('words', wordsBlob), loadBandPattern()])
    const l = drawWordsCard(ctx, { text: wordsOnCard ?? '', theme: shelter.themeColor, photo, framing: cat.framing.words, pattern })
    setWordsDesign(l.design)
    return { fits: l.fits, sec: l.sec, size: l.size, lines: l.lines, design: l.design, contrast: l.contrast, top: l.textTop, photo: photoIndex(cat.photos.length, 'words') ?? (clipBlob ? 'clip' : 'none') }
  }
  const wordsDeps = [wordsOnCard, shelter.logo, shelter.themeColor, wordsBlob, stills, cat.framing.words]

  // 写真を指で動かす（#29。猫カードの案A・ひとこと・最後の1枚）。動かしている間に写真を何度も読み直さないよう、読んだ写真を覚えておく
  const [moving, setMoving] = useState<'cat' | 'words' | 'end' | null>(null)
  // カードの言葉の案を選んだ行（#19）。猫のデータに残すので、画面を出ても［元に戻す］が使える
  const wordSwap = cardSwaps(cat.cardLines, cat.goodPoints)[0] ?? null
  const imgCache = useRef(new Map<Blob, Promise<HTMLImageElement | null>>())
  const img = (b: Blob | null) => {
    if (!b) return Promise.resolve(null)
    let p = imgCache.current.get(b)
    if (!p) imgCache.current.set(b, (p = loadImage(b).catch(() => null)))
    return p
  }
  const catBlob = cat.photos[1] ?? cat.photos[0] ?? null
  const movePaint = async (ctx: CanvasRenderingContext2D, f: Framing): Promise<Framing | null> => {
    const logo = await img(shelter.logo)
    if (moving === 'cat') {
      const photo = (await img(catBlob)) ?? (clipBlob ? still : null)
      return drawCatCard(ctx, {
        photo,
        logo,
        name: cat.name,
        profile: cardProfile(cat.age, cat.sex),
        lines: cardWordLines(cat.goodPoints, cat.cardLines),
        avoid: wordsOnCard,
        theme: shelter.themeColor,
        position: cat.textPosition,
        framing: f,
        pattern: await loadBandPattern(),
      }).framing ?? null
    }
    if (moving === 'words') {
      const photo = (await img(wordsBlob)) ?? (clipBlob ? (stills.words ?? null) : null)
      return drawWordsCard(ctx, { text: wordsOnCard ?? '', theme: shelter.themeColor, photo, framing: f }).framing
    }
    const photo = (await img(endBlob)) ?? (clipBlob ? (stills.end ?? null) : null)
    return drawEndCard(ctx, { logo, shelterName: shelter.name, contact: shelter.contact, event: usedEvent, theme: shelter.themeColor, photo, framing: f }).framing
  }
  const hasPhotoFor = (key: 'cat' | 'words' | 'end') => cat.photos.length > 0 || !!clipBlob || key === 'cat' && !!catBlob
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const tagCount = countHashtags(post)
  const tooMany = tagCount > MAX_HASHTAGS
  // ［動画を作る］：入力を確定したあと、描き直された画面の値で、押せる状態かを確かめ直してから作る
  const postBox = useRef<HTMLTextAreaElement>(null)
  const saveLatest = useRef(async () => {})
  saveLatest.current = async () => {
    if (saving || tooMany || !eventsRead || storyBlocked) return
    setSaving(true)
    setSaveFailed(false)
    try {
      await onSave(usedEvent, wordsOnCard)
    } catch {
      setSaveFailed(true)
      setSaving(false)
    }
  }
  return (
    <main className="screen">
      <TopBar title="確認（仮）" onBack={onBack} />
      {restoreNotice && <p className="alert">{restoreNotice}</p>}
      <p className="note">表紙・猫カード・ひとこと・最後の1枚です。撮った動画は、表紙と猫カードのあいだに入ります。</p>

      <section className="card-preview">
        {/* 横にめくって全部見られる（SPEC 2.4） */}
        <div className="card-strip" aria-label="カード（横にめくれます）">
          <figure className="card-slot">
            <PaintedCard paint={paintCover} deps={coverDeps} className="card-thumb card-cover" label="表紙（押すと画面いっぱいに出ます）" onClick={() => setFull('cover')} />
            <figcaption>1 表紙</figcaption>
          </figure>
          <figure className="card-slot">
            <CatCard cat={cat} shelter={shelter} avoid={wordsOnCard} still={clipBlob ? still : null} className="card-canvas" onLayout={setLayout} onClick={() => setFull('cat')} />
            <figcaption>2 猫カード</figcaption>
            {layout?.design === 'A' && hasPhotoFor('cat') && (
              <button className="btn btn-small move-photo" onClick={() => setMoving('cat')}>
                写真を動かす
              </button>
            )}
          </figure>
          {wordsOnCard && (
            <figure className="card-slot">
              <PaintedCard paint={paintWords} deps={wordsDeps} className="card-thumb card-words" label="ひとことカード（押すと画面いっぱいに出ます）" onClick={() => setFull('words')} />
              <figcaption>3 ひとこと</figcaption>
              {hasPhotoFor('words') && wordsDesign === 'A' && (
                <button className="btn btn-small move-photo" onClick={() => setMoving('words')}>
                  写真を動かす
                </button>
              )}
            </figure>
          )}
          <figure className="card-slot">
            <PaintedCard paint={paintEnd} deps={endDeps} className="card-thumb card-end" label="最後の1枚（押すと画面いっぱいに出ます）" onClick={() => setFull('end')} />
            <figcaption>{wordsOnCard ? 4 : 3} 最後の1枚</figcaption>
            {hasPhotoFor('end') && endDesign === 'A' && (
              <button className="btn btn-small move-photo" onClick={() => setMoving('end')}>
                写真を動かす
              </button>
            )}
          </figure>
        </div>
        <p className="muted center">横にめくると、ほかのカードが見られます。カードを押すと、画面いっぱいに出ます</p>
        {words && !wholeFits && (
          <div className="notice words-pick" data-picked={picked?.length ?? 0}>
            <p>
              ひとことが長くて、カードに入りきりません（カードは4行まで。書き換えはしません）。
              {wordsOnCard ? '選んだ文をカードに載せます。' : '今は、投稿文にだけ載せます。'}
              カードにも載せるときは、載せる文を選んでください（文の途中では切りません）。
            </p>
            {sentences.map((t, i) =>
              t.trim() ? (
                <label key={i} className="check-row words-row">
                  <input
                    type="checkbox"
                    checked={picked?.includes(i) ?? false}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...(p ?? []), i] : (p ?? []).filter((x) => x !== i)))}
                  />
                  <span>{t.trim()}</span>
                </label>
              ) : null,
            )}
            {picked !== null && picked.length > 0 && !pickedFits && <p className="alert">選んだ文も、まだ入りきりません。もう少し減らしてください。</p>}
            {picked !== null && picked.length > 0 && (
              <button className="btn btn-small" onClick={() => setPicked(null)}>
                投稿文にだけ載せる
              </button>
            )}
          </div>
        )}
        {/* 猫カードの言葉（SPEC 3.1。2つまで・1つ2行まで。ツールは言葉を作らない） */}
        {layout && !layout.word && layout.linesTotal === 0 && (
          <div className="notice" data-notice="no-word">
            <p>猫カードに載せる言葉がありません。「いいところ」を1行入れると、2枚目で新しく伝わります。</p>
            <button className="btn btn-small" onClick={onBack}>
              入力に戻って書く
            </button>
          </div>
        )}
        {layout && !layout.word && layout.linesTotal > 0 && (
          <div className="notice" data-notice="word-too-long">
            <p>
              {layout.skippedLong > 0
                ? '「いいところ」がどれも長くて、猫カードに入りません（1つ2行まで）。短い行を1つ足すか、短く直してください。'
                : '「いいところ」が、ひとことカードと同じ文だけなので、猫カードには載せません。ほかの「いいところ」を1行足してください。'}
            </p>
            <button className="btn btn-small" onClick={onBack}>
              入力に戻って書く
            </button>
          </div>
        )}
        {layout?.word && (layout.skippedLong > 0 || layout.wordIndex > 0) && (
          <p className="notice" data-notice="word-next">
            {layout.skippedLong > 0
              ? `「いいところ」のうち${layout.skippedLong}行は、長いか文字が多くて猫カードに入らないので、載せていません（顔にかからないようにしています）。`
              : 'ひとことカードと同じ文は使わないので、'}
            {layout.wordIndexes.map((i) => i + 1).join('・')}行目「{layout.words.join('」「')}」を猫カードに載せました{wordSwap ? '' : '（書き換えていません）'}。
          </p>
        )}
        {/* カードの言葉の案（#19）。長くて入らなかった行があるときだけ。人が選んだときだけ使う */}
        {layout && (layout.longLines.length > 0 || wordSwap) && (
          <WordIdeas
            cat={cat}
            longLines={layout.longLines}
            used={wordSwap}
            onUse={(from, to) => onCatChange((c) => ({ ...c, cardLines: addSwap(c.cardLines, from, to) }))}
            onUndo={() => {
              if (wordSwap) onCatChange((c) => ({ ...c, cardLines: removeSwap(c.cardLines, wordSwap.from) }))
            }}
          />
        )}
        {layout?.word && layout.scale < 1 && <p className="notice">言葉が長いので、カードの文字を少し小さくしました。</p>}
        {layout && layout.words.length === 2 && <p className="muted">言葉が2つなので、猫カードは5秒にします。</p>}
        {layout && !layout.fits && <p className="alert">名前が長くて、カードに入りきりません。</p>}
        {!coverFits && <p className="alert">名前が長くて、表紙に入りきりません。</p>}
        {!endFits && (
          <p className="alert">
            最後の1枚の文字が多くて入りきりません（写真の顔にかからないようにし、連絡先は読める大きさより小さくしません）。シェルター情報の団体名や連絡先を短くするか、譲渡会を入れないでください。
          </p>
        )}

        {layout?.design === 'B' && (
          <p className="muted center">横長・正方形の写真なので、文字は上の色の帯に入ります。縦長の写真なら、写真の上に文字が載ります</p>
        )}
        {/* カードを描き終わってから出す（開いた直後に、案Bでも一瞬出てしまわないように） */}
        {layout?.design === 'A' && (
        <div className="choices" role="group" aria-label="文字の位置">
          {POSITIONS.map(([v, label]) => (
            <button
              key={v}
              className={`chip ${cat.textPosition === v ? 'chip-on' : ''}`}
              onClick={() => onCatChange((c) => ({ ...c, textPosition: v }))}
            >
              {label}
            </button>
          ))}
        </div>
        )}
      </section>

      {event && (
        <label className="check-row">
          <input type="checkbox" checked={showEvent} onChange={(e) => setShowEvent(e.target.checked)} />
          最後の1枚に、次の譲渡会（{event.date.slice(5).replace('-', '/')}）を入れる
        </label>
      )}
      {!event && <p className="muted">次の譲渡会が登録されていないので、最後の1枚には団体名と連絡先だけを入れます。</p>}

      {moving && (
        <FramingEditor
          key={moving}
          title={{ cat: '猫カード', words: 'ひとことカード', end: '最後の1枚' }[moving]}
          initial={cat.framing[moving]}
          paint={movePaint}
          onCancel={() => setMoving(null)}
          onDone={(f) => {
            const key = moving
            onCatChange((c) => {
              const framing = { ...c.framing }
              if (f) framing[key] = f
              else delete framing[key]
              return { ...c, framing }
            })
            setMoving(null)
          }}
        />
      )}

      {full && (
        <div className="card-full" role="dialog" aria-label="カードを画面いっぱいに表示" onClick={() => setFull(null)}>
          {full === 'cat' && <CatCard cat={cat} shelter={shelter} avoid={wordsOnCard} still={clipBlob ? still : null} className="card-full-canvas" onClick={() => setFull(null)} />}
          {full === 'cover' && <PaintedCard paint={paintCover} deps={coverDeps} className="card-full-canvas" label="表紙" onClick={() => setFull(null)} />}
          {full === 'words' && wordsOnCard && <PaintedCard paint={paintWords} deps={wordsDeps} className="card-full-canvas" label="ひとこと" onClick={() => setFull(null)} />}
          {full === 'end' && <PaintedCard paint={paintEnd} deps={endDeps} className="card-full-canvas" label="最後の1枚" onClick={() => setFull(null)} />}
          <button className="card-close" onClick={() => setFull(null)}>
            × 閉じる
          </button>
          <p className="card-full-hint">画面のどこを押しても閉じます</p>
        </div>
      )}

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

      {/* 物語の本文（#16。読み取りの作業場所だけ） */}
      <WriteStory
        cat={cat}
        shelter={shelter}
        post={post}
        live={live}
        primary={draftOnly}
        onPost={(p, result) => {
          ;(onStoryPost ?? onPostChange)(p)
          const s = { result, check: null }
          onStoryChange(s)
          void runCheck(s)
        }}
      />
      {story && storyInPost && (
        <StoryCheck
          story={story.result}
          check={checkState}
          name={cat.name}
          post={post}
          onKeep={(i) => story.check && onStoryChange({ ...story, check: { ...story.check, kept: [...story.check.kept, i] } })}
          onRemove={(i, s) => {
            onPostChange(removeSentence(post, s))
            if (story.check) onStoryChange({ ...story, check: { ...story.check, removed: [...(story.check.removed ?? []), i] } })
          }}
          onRetry={() => void runCheck(story)}
          onDropStory={async () => {
            // 手で書き足していたら、黙って消さない（見直しの重い7）
            const generated = makeFixedPost(cat, shelter, new Date(), story.result.body)
            if (post !== generated && !(await askConfirm('投稿文を手で直しています。直した文も消えて、決まった形の投稿文に戻ります。戻しますか？', { yes: '戻す' }))) return
            onPostChange(makeFixedPost(cat, shelter))
            onStoryChange(null)
            setChecking('idle')
          }}
        />
      )}

      {draftOnly && (
        <p className="notice" data-draft-notice>
          まだ下書きです。［物語の本文を書いてもらう］を押すと、メモから紹介文を書きます。
        </p>
      )}
      <label className="field">
        <span>投稿文（その場で直せます）</span>
        <textarea ref={postBox} rows={14} value={post} onChange={(e) => onPostChange(e.target.value)} />
        <small className="muted">本文はClaudeが書き、年齢・健康・連絡先・ハッシュタグはプログラムが決まった形で足します。投稿する前に、必ず読んで確かめてください</small>
      </label>

      <div className="bottom-bar">
        {/* 押した場所のすぐ上に出す（スクロールしなくても見えるように） */}
        {saveFailed && <p className="alert bar-alert">名簿に保存できませんでした。もう一度押してください。</p>}
        {/* 印の文をすべて確かめるまで、［動画を作る］は押せない（SPEC 2.4） */}
        {storyBlocked && (
          <p className="alert bar-alert" data-story-blocked="1">
            {checkState.status === 'checking'
              ? '本文の根拠を確かめています…'
              : checkState.status === 'stale'
                ? checkState.limit
                  ? '回数の上限で、本文の根拠を確かめ直せません。上の［本文を外して、決まった形に戻す］を押すと、動画を作れます。'
                  : `${checkState.what === 'facts' ? '名前か「いいところ」' : 'メモ'}が変わりました。上の［もう一度確かめる］を押してください。`
              : checkState.status === 'failed'
                ? checkLimit
                  ? '回数の上限で、本文の根拠を確かめられません。上の［本文を外して、決まった形に戻す］を押すと、動画を作れます。'
                  : '本文の根拠を確かめられませんでした。上の［もう一度確かめる］を押してください。'
                : `印の文があと${flags.length}つあります。`}
            {flags.length > 0 && (
              <button className="btn btn-small" onClick={() => document.getElementById(`story-line-${flags[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                次の印の文へ
              </button>
            )}
          </p>
        )}
        <button
          className={draftOnly ? 'btn btn-big' : 'btn btn-primary btn-big'} // 本文を書く前は、［物語の本文を書いてもらう］のほうを目立たせる
          disabled={saving || tooMany || !eventsRead || storyBlocked}
          onClick={() => {
            // iPhone の日本語入力で、変換を確定する前に押したとき、投稿文の欄の最後の文字が入らないまま作らないように、
            // 欄に見えている文字を入力に入れ、画面が描き直されてから（ハッシュタグの数などを確かめ直して）作る（11/7 作者が iPhone で見つけた件と同じ）
            flushTyped(postBox.current)
            window.setTimeout(() => void saveLatest.current(), 0)
          }}
        >
          動画を作る
        </button>
      </div>
    </main>
  )
}
