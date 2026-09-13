import { useEffect, useMemo, useState } from 'react'
import { BookOpen, LockKeyhole, Phone, Play, ShieldCheck } from 'lucide-react'
import './App.css'
import { CallContract } from './components/CallContract'
import { ConsentTimeline } from './components/ConsentTimeline'
import { EvidenceRail } from './components/EvidenceRail'
import { Header } from './components/Header'
import { StoryCard } from './components/StoryCard'
import { demoStory, stageOrder, type StoryStage } from './data/demoStory'
import { applyCorrection } from './data/storyState'

const autoplayStages: StoryStage[] = ['disclosure', 'permission', 'question', 'readback', 'correction']

function App() {
  const [stage, setStage] = useState<StoryStage>('ready')
  const [autoplay, setAutoplay] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correction, setCorrection] = useState<string>(demoStory.correction)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const stageIndex = stageOrder.indexOf(stage)
  const isConfirmed = stageIndex >= stageOrder.indexOf('confirmed') && stage !== 'deleted'

  useEffect(() => {
    if (!autoplay) return
    const next = autoplayStages.find((item) => stageOrder.indexOf(item) > stageIndex)
    if (!next) {
      setAutoplay(false)
      return
    }
    const timer = window.setTimeout(() => setStage(next), 720)
    return () => window.clearTimeout(timer)
  }, [autoplay, stageIndex])

  const status = useMemo(() => {
    if (stage === 'deleted') return ['Deleted locally', 'The no-call story and transcript have been removed.']
    if (stage === 'published') return ['Shared with family', 'The confirmed story is now in the family space.']
    if (stage === 'private') return ['Kept private', 'Only the storyteller can see this confirmed story.']
    if (isConfirmed) return ['Confirmed by the storyteller', 'Corrected once, then read back and confirmed.']
    if (stage === 'correction') return ['Waiting for confirmation', 'The story is not created yet.']
    if (stage === 'ready') return ['Ready for a no-call rehearsal', 'No real number or CALL-E credit is used.']
    return ['Call rehearsal in progress', 'The no-call fixture is advancing through the consent contract.']
  }, [isConfirmed, stage])

  const startDemo = () => {
    setStage('ready')
    setCorrectionOpen(false)
    setDeleteOpen(false)
    setAutoplay(true)
  }

  const confirmCorrection = () => {
    if (!applyCorrection(demoStory.originalAnswer, correction).confirmed) return
    setCorrectionOpen(false)
    setStage('confirmed')
  }

  const resetDemo = () => {
    setStage('ready')
    setAutoplay(false)
    setCorrectionOpen(false)
    setDeleteOpen(false)
    setCorrection(demoStory.correction)
  }

  return (
    <div className="app-shell" id="top">
      <Header onReset={resetDemo} />
      <main>
        <section className="intro" aria-labelledby="page-title">
          <div className="intro-copy">
            <h1 id="page-title">Ask once. Listen well.</h1>
            <p className="lede">One thoughtful phone call. Nothing becomes a story until they say it&rsquo;s right.</p>
            <div className="primary-actions">
              <button className="button button-primary" type="button" onClick={() => setPreviewOpen(true)}><Phone aria-hidden="true" />Preview the call</button>
              <button className="button button-secondary" type="button" onClick={startDemo}><Play aria-hidden="true" />Try the no-call demo</button>
              <span>Safe, private, and needs no real number.</span>
            </div>
            <CallContract />
          </div>
          <div className="proof-surface" aria-live="polite">
            <div className={`status-strip status-${stage}`}>
              {isConfirmed ? <ShieldCheck aria-hidden="true" /> : <BookOpen aria-hidden="true" />}
              <div><strong>{status[0]}</strong><span>{status[1]}</span></div>
            </div>
            <div className="proof-grid">
              <ConsentTimeline stage={stage} />
              <div className="evidence-story">
                <EvidenceRail stage={stage} correction={correction} />
                <StoryCard
                  stage={stage}
                  correction={correction}
                  correctionOpen={correctionOpen}
                  deleteOpen={deleteOpen}
                  onOpenCorrection={() => setCorrectionOpen((open) => !open)}
                  onCorrectionChange={setCorrection}
                  onConfirmCorrection={confirmCorrection}
                  onPublish={() => setStage('published')}
                  onKeepPrivate={() => setStage('private')}
                  onOpenDelete={() => setDeleteOpen(true)}
                  onCancelDelete={() => setDeleteOpen(false)}
                  onDelete={() => { setDeleteOpen(false); setStage('deleted') }}
                />
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer id="privacy">
        <p><LockKeyhole aria-hidden="true" /> Privacy first, always. No story is saved or shared until the storyteller confirms it.</p>
        <nav aria-label="Footer"><a href="#privacy">Privacy</a><a href="#how-it-works">How it works</a></nav>
      </footer>
      {previewOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Close preview" onClick={() => setPreviewOpen(false)}>×</button>
            <p className="modal-label">Spoken-call preview</p>
            <h2 id="preview-title">What your loved one will hear</h2>
            <ol>
              <li><strong>Disclosure</strong><span>“Hi, I’m an AI calling from One More Story for your family.”</span></li>
              <li><strong>Permission</strong><span>“Is it okay to continue and save your answer for read-back?”</span></li>
              <li><strong>One question</strong><span>“{demoStory.question}”</span></li>
              <li><strong>Read-back</strong><span>The agent repeats what it heard and accepts a correction.</span></li>
              <li><strong>Confirmation</strong><span>No story exists until the storyteller says the read-back is right.</span></li>
            </ol>
            <button className="button button-primary" type="button" onClick={() => { setPreviewOpen(false); startDemo() }}>Run this as a no-call demo</button>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
