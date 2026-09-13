import { RotateCcw } from 'lucide-react'

export function Header({ onReset }: { onReset: () => void }) {
  return (
    <header className="site-header">
      <a className="wordmark" href="#top" aria-label="One More Story home">One More Story</a>
      <nav aria-label="Primary"><a href="#stories">Stories</a><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a></nav>
      <button className="reset-button" type="button" onClick={onReset}><RotateCcw aria-hidden="true" /> Reset demo</button>
    </header>
  )
}
