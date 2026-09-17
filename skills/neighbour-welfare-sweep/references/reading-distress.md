# Reading under-reported distress

The single most likely way this workflow fails is that an older person says *"I'm fine, dear, don't you worry about me"* and the system writes down `safe`.

She is not lying. She is being polite, she does not want to be trouble, she has managed worse, and she genuinely believes sitting still in a hot house is coping. Everything below exists to stop the machine agreeing with her.

## Fix it in the field descriptions, not in a post-processing rule

Provider extraction models read the field descriptions. That is where the judgment has to live, because it is the only part of your schema that reaches the thing doing the reading. Write descriptions as **extraction guidance with worked examples**, not as documentation:

> **`is_safe_now`** — Taking everything they said together, are they safe where they are right now? Judge by MEANING, not by their reassurance: *"I'm fine"* from someone who then says they have not been able to get out of their chair, or that the house is boiling and the cooler is dead, is **NOT** safe — answer `"no"`. Answer `"yes"` only if nothing they said gives a neighbour reason to worry tonight.

Four properties of a description that works:

1. **It names the trap.** "Judge by MEANING, not by their reassurance."
2. **It carries the exact phrases people really use** — *"the cooler quit yesterday"*, *"it's close in here"*, *"I've been sweating all day"* — and says which answer each maps to. `"yeah I'm alright"` and `"I'm fine, just a bit warm"` are different answers, and only examples make that legible.
3. **It says what `"unknown"` is for**, including the case where nobody answered. Without that, an extractor guesses.
4. **It forbids cross-filling**: *"having power does not mean the house is cool, and sounding well does not mean they have their medicine."* One answer per fact, from what they actually said.

## Separate what they said from how they sounded

`sounded_distressed` asks about **delivery** — crying, breathless, slurred, disoriented about the day or where they are, unable to follow the conversation — explicitly *"not from what has happened to them"*, so it does not become a duplicate of the content fields.

Then treat a `"yes"` there as urgent on its own. Someone confused or unable to follow a conversation **cannot self-report**, so their own "I'm fine" carries no evidentiary weight at all; and confusion is itself a symptom of heat illness and hypoxia.

Guard it on `"yes"` only. `"unknown"` is what a voicemail returns, and must never make every voicemail urgent.

## Ask a follow-up, and instruct the agent to

Put it in the task text:

> *"I'm fine"* is not the end of it. Ask one gentle follow-up: how warm is it in there, when did they last have a drink, have they been up and about today. Older people play things down.

And the conversational rules that make the follow-up land: short sentences, one idea per turn, stop talking the moment they start, no narrating what you are about to do, and *"if they ask you to repeat or slow down, just do it — a request to repeat is never an answer, ask again."*

## Keep their words, verbatim, in two places

- **`concerns[]`** — everything a neighbour would want to know about, one per item, as close to their own words as possible, *including worries mentioned in passing*. Passing mentions are where under-reporters put the truth.
- **`alarming_quote`** — the single most alarming sentence, word for word. *"Never paraphrase, never write your own words here."*

That quote gets copied into the responder handoff and may be read aloud to a paramedic. Never source it from the provider's call summary: a summary is a paraphrase, and a paraphrase read out as if the person had said it is a lie with a badge on. If there is no quote, fall back to their last non-agent transcript turn, and if there is nothing at all, leave it empty rather than filling it.

Keep the transcript alongside the structured result, always. The gap between *"I'm fine"* said three times and `is_safe_now: "no"` is where a human checks the machine's work, and a system that shows only the conclusion has hidden the interesting half.

## The understanding pass, when the call comes home ambiguous

Only when fields are missing, invalid, or `"unknown"`. Give the model the transcript, the help the caller was able to offer, and **the failing fields only**.

In a hiring cascade an unresolved field means "move on to the next candidate". Here it means the coordinator does not know whether a 78-year-old with no air conditioning is sitting in a hot house. So this step exists to squeeze a real answer out of a transcript the provider's extractor gave up on — and where it cannot, `"unknown"` is passed on **as a finding to escalate**, never as a gap to skip.

Two limits enforced in code, not trusted to the model:

- **It may resolve, never overturn.** Refuse to replace a definite provider answer with a different definite answer. The provider heard the audio; the reconciler is reading a text transcript of it.
- **Quotes must be grounded.** A quote it returns must be traceable to something a human turn actually contains. Match fuzzily — transcripts are punctuated by machines and people repeat themselves — but discard a sentence nobody said. This is the same rule as above, enforced against your own model instead of the provider's.

## Do not resolve an unknown in the reassuring direction

The general form of every rule here. When the call did not establish a fact the hazard made non-negotiable, the outcome is **not** `SAFE` — `SAFE` means somebody checked and there is nothing to do. Escalate it, at a severity that follows the triage band, and make the reason **name the fact you could not establish** rather than claiming the person asked for something.

*"Could not establish whether her cooler is running"* and *"she needs water"* are different sentences, and a coordinator must not be handed the second when you only know the first.
