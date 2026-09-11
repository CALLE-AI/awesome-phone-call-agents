import { FileQuestion, LockKeyhole, UsersRound } from 'lucide-react'
import { demoStory } from '../data/demoStory'

const rows = [
  { icon: FileQuestion, label: 'Question', value: demoStory.question },
  { icon: UsersRound, label: 'Who will hear it', value: 'Only invited family members you choose.' },
  { icon: LockKeyhole, label: 'What will be saved', value: 'Their words, the AI read-back, their correction, and confirmation.' },
]

export function CallContract() {
  return (
    <section className="call-contract" aria-labelledby="contract-title" id="how-it-works">
      <h2 id="contract-title">Call contract</h2>
      {rows.map(({ icon: Icon, label, value }) => <div className="contract-row" key={label}><Icon aria-hidden="true" /><span>{label}</span><strong>{value}</strong></div>)}
    </section>
  )
}
