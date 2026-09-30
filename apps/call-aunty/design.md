# Call Aunty Mobile Interface Design

## Product direction

Call Aunty is a Bangla-first maternal care companion for women and a focused field workflow for community health workers. The mobile experience should feel warm, calm, and trustworthy while making the next action unmistakable. The app complements phone and SMS care; it does not present itself as a diagnostic authority.

## Screen list

| Screen | Primary content and functionality |
|---|---|
| Welcome / role selection | Explains the trusted-voice concept, lets the user choose Woman or Community Health Worker, and offers Bangla/English language selection. |
| Woman home | Shows pregnancy-care stage, the next recommended care contact, a friendly Aunty greeting, voice-call shortcut, and urgent-care guidance card. |
| Check-in | A short, resumable, large-touch questionnaire with symptom prompts, yes/no controls, voice/SMS fallback, and a clear completion state. |
| Care plan | Lists upcoming ANC/follow-up actions, reminders, education topics, and completion status. |
| Referral detail | Explains why a human health worker should be contacted, provides Call CHW / Send SMS actions, and records whether the referral was acknowledged. |
| CHW dashboard | Displays prioritized work queue, red-flag cases, due-today follow-ups, unresolved referrals, and sync state. |
| Woman record | Gives a CHW the minimum context for the next action: preferred name, stage, recent check-in, risk signal, notes, and contact actions. |
| New follow-up | Lets a CHW capture a structured follow-up, schedule a callback, add a note, and mark the next action. |
| Settings | Language, safe contact preferences, reminder window, privacy lock, and role switching. |

## Key user flows

### Woman onboarding and first action

1. User opens Call Aunty and selects Woman.
2. User chooses Bangla or English and confirms a safe contact preference.
3. The home screen shows the next care action and a neutral voice-call entry point.
4. User starts a check-in, answers a small number of structured questions, and can pause and resume.
5. The app closes with one next action: continue routine care, contact the CHW today, or seek urgent in-person care now.

### CHW prioritization

1. CHW opens the dashboard and sees red-flag items first.
2. CHW opens a woman record and reviews the structured summary rather than a long transcript.
3. CHW calls or sends an SMS using the action card.
4. CHW records the outcome and schedules the next follow-up.
5. The item leaves the active queue only when the next action is explicit.

### Escalation

1. A check-in answer triggers a safety warning.
2. The woman sees a calm explanation that the app cannot assess the situation fully.
3. The app provides an urgent in-person-care instruction and a CHW contact option.
4. The CHW dashboard receives a prioritized escalation marker when sync is available.

## Visual language

The brand uses a deep indigo base for trust, a warm coral accent for human warmth, soft mint for safe/complete states, and pale sand surfaces that read clearly in bright outdoor conditions. Cards use generous corner radii and strong hierarchy. Primary actions are full-width, thumb-reachable, and never rely on color alone.

| Token | Choice | Use |
|---|---|---|
| Ink | `#20233B` | Primary text and navigation |
| Indigo | `#4547A9` | Brand, primary actions, selected states |
| Coral | `#E97863` | Warm accent, Aunty moments, secondary emphasis |
| Sand | `#FFF8F1` | Main background |
| Surface | `#FFFFFF` | Cards and elevated controls |
| Mint | `#DFF4E8` | Safe and completed states |
| Amber | `#F4B860` | Due-soon and attention states |
| Red | `#C95252` | Urgent escalation only |
| Muted | `#73758C` | Supporting copy |

The layout assumes portrait 9:16 use and one-handed interaction. The bottom tab bar is limited to Home, Care, and Settings for women; CHWs receive Home, Queue, and Settings. Touch targets are at least 44 points, copy is concise, and every critical path remains usable without typing.
