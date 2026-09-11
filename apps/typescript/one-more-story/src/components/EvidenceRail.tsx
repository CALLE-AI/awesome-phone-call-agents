import { CheckCircle2, PencilLine, Play } from 'lucide-react'
import { demoStory, stageOrder, type StoryStage } from '../data/demoStory'

export function EvidenceRail({ stage, correction }: { stage: StoryStage; correction: string }) {
  const isDeleted = stage === 'deleted'
  const index = stageOrder.indexOf(stage)
  const showQuestion = !isDeleted && index >= stageOrder.indexOf('question')
  const showAnswer = !isDeleted && index >= stageOrder.indexOf('readback')
  const showCorrection = !isDeleted && index >= stageOrder.indexOf('correction')
  const showConfirmation = !isDeleted && (index >= stageOrder.indexOf('confirmed') || ['private', 'published'].includes(stage))
  const focusedProof = showConfirmation
  return (
    <section className="evidence-rail" aria-labelledby="evidence-title" id="stories">
      <div className="evidence-heading"><h2 id="evidence-title">Source evidence</h2><span>no-call fixture</span></div>
      <div className="transcript">
        {isDeleted && <p className="evidence-empty">No transcript remains in this local demo session.</p>}
        {!isDeleted && !focusedProof && <article className="transcript-row"><time>00:00</time><div><strong>AI</strong><p>Hi, I’m calling from One More Story, an AI service that helps families preserve meaningful memories.</p></div><Play aria-hidden="true" /></article>}
        {!isDeleted && !focusedProof && <article className="transcript-row"><time>00:18</time><div><strong>AI</strong><p>Do you feel comfortable continuing?</p><strong className="human">Storyteller: Yes, that’s fine.</strong></div><Play aria-hidden="true" /></article>}
        {showQuestion && !focusedProof && <article className="transcript-row"><time>00:26</time><div><strong>AI</strong><p>{demoStory.question}</p></div><Play aria-hidden="true" /></article>}
        {showAnswer && <article className="transcript-row"><time>01:05</time><div><strong className="human">Storyteller</strong><p>{demoStory.originalAnswer}</p></div><Play aria-hidden="true" /></article>}
        {showCorrection && <article className="transcript-row correction"><time>01:16</time><div><strong>You corrected</strong><p>{correction}</p></div><PencilLine aria-hidden="true" /></article>}
        {showConfirmation && <article className="transcript-row confirmation"><time>01:24</time><div><strong>Storyteller</strong><p>Yes, that’s right.</p></div><CheckCircle2 aria-hidden="true" /></article>}
      </div>
    </section>
  )
}
