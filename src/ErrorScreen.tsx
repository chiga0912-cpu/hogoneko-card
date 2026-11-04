import { Component, type ReactNode } from 'react'
import { clearDraft } from './db'

// 画面を出す途中で止まったときに、真っ白のままにしない
// 名簿は消さない。入力の途中だけを消して開き直す道も出す（途中が原因のことがあるため）
export default class ErrorScreen extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="screen">
        <p className="alert">画面を出せませんでした。名簿は消していません。</p>
        <div className="stack">
          <button className="btn btn-primary btn-big" onClick={() => location.reload()}>
            開き直す
          </button>
          <button
            className="btn btn-big"
            onClick={async () => {
              if (!window.confirm('入力の途中の内容だけを消して、開き直しますか？（名簿とシェルター情報は消しません）')) return
              try {
                await clearDraft()
              } finally {
                location.reload()
              }
            }}
          >
            入力の途中を消して開き直す
          </button>
        </div>
      </main>
    )
  }
}
