import { Check, Link2, LockKeyhole, PencilLine, Trash2, UsersRound, X } from 'lucide-react'
import { demoStory, stageOrder, type StoryStage } from '../data/demoStory'

type Props = {
  stage: StoryStage
  correction: string
  correctionOpen: boolean
  deleteOpen: boolean
  onOpenCorrection: () => void
  onCorrectionChange: (value: string) => void
  onConfirmCorrection: () => void
  onPublish: () => void
  onKeepPrivate: () => void
  onOpenDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}

export function StoryCard(props: Props) {
  const index = stageOrder.indexOf(props.stage)
  const readyForReview = index >= stageOrder.indexOf('correction')
  const confirmed = index >= stageOrder.indexOf('confirmed') && props.stage !== 'deleted'
  const storyText = confirmed ? demoStory.correctedAnswer : demoStory.originalAnswer

  if (props.stage === 'deleted') {
    return <section className="story-card empty-story"><Trash2 aria-hidden="true" /><h2>Story deleted</h2><p>The local fixture no longer contains the story or transcript.</p></section>
  }

  return (
    <section className={`story-card ${confirmed ? 'confirmed' : ''} ${readyForReview ? 'revealed' : ''}`} aria-labelledby="story-title">
      <div className="story-rule" aria-hidden="true"><span /></div>
      <h2 id="story-title">{readyForReview ? demoStory.title : 'A story will appear here'}</h2>
      <p className="story-copy">{readyForReview ? (confirmed ? <>It smelled like wet paper, <mark>mint leaves</mark>, and a little sugar from the tea shop. The air was cool, and the roses had just arrived from the hills.</> : storyText) : 'The story stays hidden until disclosure, permission, one question, and read-back are complete.'}</p>
      {confirmed && <p className="proof-line"><Link2 aria-hidden="true" />1 correction · 1 confirmation · source linked</p>}
      {props.correctionOpen ? (
        <div className="correction-editor">
          <label htmlFor="correction">Correct what the AI heard</label>
          <input id="correction" value={props.correction} onChange={(event) => props.onCorrectionChange(event.target.value)} autoFocus />
          <div><button type="button" className="button button-primary" onClick={props.onConfirmCorrection}><Check aria-hidden="true" />Read correction back</button><button type="button" className="icon-button" onClick={props.onOpenCorrection} aria-label="Close correction"><X aria-hidden="true" /></button></div>
        </div>
      ) : props.deleteOpen ? (
        <div className="delete-confirm">
          <p><strong>Delete this local demo story?</strong><span>This removes the fixture from the current session.</span></p>
          <button type="button" onClick={props.onDelete}>Delete now</button><button type="button" onClick={props.onCancelDelete}>Cancel</button>
        </div>
      ) : (
        <div className="story-actions">
          {!confirmed && <button type="button" onClick={props.onOpenCorrection} disabled={!readyForReview}><PencilLine aria-hidden="true" />That’s not quite right</button>}
          {confirmed && <button className="publish" type="button" onClick={props.onPublish}><UsersRound aria-hidden="true" />Publish to family</button>}
          {confirmed && <button type="button" onClick={props.onKeepPrivate}><LockKeyhole aria-hidden="true" />Keep private</button>}
          <button className="destructive" type="button" onClick={props.onOpenDelete} disabled={!readyForReview}><Trash2 aria-hidden="true" />Delete forever</button>
        </div>
      )}
      <p className="story-lock"><LockKeyhole aria-hidden="true" />{confirmed ? 'Confirmed by the storyteller. Sharing is still your choice.' : 'This story is not created yet. Confirmation is required.'}</p>
    </section>
  )
}
