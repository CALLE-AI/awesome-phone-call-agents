import { Check } from 'lucide-react'
import { stageOrder, type StoryStage } from '../data/demoStory'

const steps = [
  ['disclosure', 'Disclosure', 'AI says what it is and why it is calling.'],
  ['permission', 'Permission', 'The storyteller chooses whether to continue.'],
  ['question', 'One question', 'They answer one meaningful question.'],
  ['readback', 'Read-back', 'AI repeats what it heard for accuracy.'],
  ['confirmed', 'Confirmed', 'They confirm or correct the read-back.'],
] as const

export function ConsentTimeline({ stage }: { stage: StoryStage }) {
  const current = stageOrder.indexOf(stage)
  return (
    <ol className="timeline" aria-label="Consent timeline">
      {steps.map(([key, title, description], index) => {
        const complete = current >= stageOrder.indexOf(key) || ['private', 'published'].includes(stage)
        const active = !complete && stageOrder.indexOf(key) === current + 1
        return <li className={`${complete ? 'complete' : ''} ${active ? 'active' : ''}`} key={key}><span className="step-marker">{complete ? <Check aria-hidden="true" /> : index + 1}</span><div><strong>{title}</strong><p>{description}</p><span>{complete ? 'Complete' : active ? 'Current' : 'Waiting'}</span></div></li>
      })}
    </ol>
  )
}
