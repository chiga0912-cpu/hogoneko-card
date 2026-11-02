import { useState } from 'react'
import { emptyCat, emptyShelter, type Cat, type Shelter } from './types'
import { makeDraftPost } from './draft'
import Home from './screens/Home'
import ShelterForm from './screens/ShelterForm'
import CatForm from './screens/CatForm'
import Preview from './screens/Preview'
import Save from './screens/Save'

export type Screen = 'home' | 'shelter' | 'cat' | 'preview' | 'save'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [shelter, setShelter] = useState<Shelter>(emptyShelter)
  const [cat, setCat] = useState<Cat>(emptyCat)
  const [post, setPost] = useState('')

  const go = (next: Screen) => {
    setScreen(next)
    window.scrollTo(0, 0)
  }

  const toPreview = () => {
    setPost(makeDraftPost(cat, shelter))
    go('preview')
  }

  return (
    <div className="app" style={{ ['--theme' as string]: shelter.themeColor }}>
      {screen === 'home' && <Home shelter={shelter} go={go} />}
      {screen === 'shelter' && (
        <ShelterForm shelter={shelter} onChange={setShelter} onDone={() => go('home')} />
      )}
      {screen === 'cat' && (
        <CatForm cat={cat} onChange={setCat} onBack={() => go('home')} onNext={toPreview} />
      )}
      {screen === 'preview' && (
        <Preview
          cat={cat}
          shelter={shelter}
          post={post}
          onPostChange={setPost}
          onBack={() => go('cat')}
          onNext={() => go('save')}
        />
      )}
      {screen === 'save' && (
        <Save post={post} onBack={() => go('preview')} onHome={() => go('home')} />
      )}
    </div>
  )
}
