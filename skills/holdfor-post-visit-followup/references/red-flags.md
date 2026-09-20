# Red-flag phrases

The list a Check-in Call is scanned against. One phrase per line, under the source
it came from.

## What this list is, and what it is not

Every phrase below is a lay-speech rendering of a symptom that a published NHS page
tells the public to seek urgent help for. The NHS wording is quoted verbatim under
each heading; the phrases beneath it are what a patient might actually say on the
telephone, written so a string matcher can find them.

The distinction matters and must not be smoothed over: **NHS did not publish this
match list.** NHS published the clinical judgement about which symptoms are urgent.
The renderings are ours, and they are the part that can be wrong. Anyone revising
this file should change a phrase freely and treat the quoted source as fixed.

This is a **routing trigger, not a screening instrument**. A match does not mean the
Patient has the condition under the heading, and no phrase here is scored, ranked or
graded for severity. A match means one thing: the Review Item is flagged and a named
human reads the call. See [ADR 0005](../../../docs/adr/0005-stop-conditions-are-enforced-twice.md).

The list is deliberately over-inclusive. A false flag costs a Reviewer two minutes of
reading. A miss costs an 82-year-old the call that would have caught it. Those two are
not comparable, so the list leans toward flagging and the asymmetry is on purpose.

## Matching rules

- Case-folded, matched on word boundaries, against `"other"` turns only.
- A phrase matches as a whole phrase; `short of breath` does not match `breath` alone.
- The agent never sees this file. Only the prompt builder and `scan()` read it, and
  both read it through the same loader, so the two cannot drift apart.
- A section contributes phrases only if it carries a line beginning `Source:`, and
  that line must hold the URL. An uncited group is skipped rather than trusted, and a
  test fails if a `Source:` line has been wrapped so the link falls to the next line.

## Sepsis

Source: https://www.nhs.uk/conditions/sepsis/ — "Call 999 or go to A&E if an adult or
child aged 5 years or over: is breathing very fast; is confused, has slurred speech,
or is not making sense; has blue, pale or blotchy skin; has a very high or very low
temperature, feels hot or cold to the touch, or is shivery; has a rash that does not
fade when you press it".

- breathing very fast
- not making sense
- shivering
- shivery
- burning up
- freezing cold
- blotchy
- rash
- passed no water
- not passed water
- not been to the toilet all day

## Heart attack

Source: https://www.nhs.uk/conditions/heart-attack/ — "Call 999 if: you have chest
pain that feels tight or like squeezing on your chest; you have chest pain that's
spreading to your arms, neck or jaw; you're having severe difficulty breathing —
you're gasping, choking or not able to get words out".

- chest pain
- pain in my chest
- chest is tight
- tightness in my chest
- squeezing
- pain in my arm
- pain in my jaw
- gasping
- can't catch my breath
- cannot catch my breath
- short of breath
- breathless

## Stroke

Source: https://www.nhs.uk/conditions/stroke/symptoms/ — "face weakness — one side of
your face may droop (fall) and it might be hard to smile; arm weakness — you may not
be able to fully lift both arms and keep them there because of weakness or numbness
in 1 arm; speech problems — you may slur your words or sound confused". The page adds
"Call 999 now if you think you're having, or have had a stroke" and "you've had signs
of a stroke within the last 24 hours even if they've now stopped".

- face has dropped
- side of my face
- can't smile
- cannot smile
- can't lift my arm
- cannot lift my arm
- arm has gone weak
- gone numb
- slurring
- slurred
- words won't come
- words will not come

## Allergic reaction to a medication

Source: https://www.nhs.uk/conditions/anaphylaxis/ — "Call 999 if: your lips, mouth,
throat or tongue suddenly become swollen; you're breathing very fast or struggling to
breathe; your throat feels tight or you're struggling to swallow; you suddenly become
very confused, drowsy or dizzy".

- lips have swollen
- tongue has swollen
- throat feels tight
- throat has closed
- can't swallow
- cannot swallow
- struggling to swallow
- come out in a rash since
- reaction to the tablets
- reaction to the new tablets

## Confusion and drowsiness

Source: https://www.nhs.uk/conditions/sepsis/ ("is confused, has slurred speech, or is
not making sense") and https://www.nhs.uk/conditions/anaphylaxis/ ("you suddenly
become very confused, drowsy or dizzy").

- confused
- muddled
- can't think straight
- cannot think straight
- keep dropping off
- can't stay awake
- cannot stay awake
- fainted
- passed out
- blacked out

## Wound and post-procedure complications

Source: https://www.cuh.nhs.uk/patient-information/caring-for-your-surgical-wound/ —
"If a wound becomes infected it may: become more painful; look red or swollen; start
to open, weep or leak some blood-like fluid, pus or blood; have an unpleasant smell",
and "if you develop a high temperature, notice any of the signs mentioned above, or
have any concerns about your wound, then contact the named nurse".

- wound
- stitches
- dressing
- weeping
- oozing
- pus
- smells
- gone septic
- opened up
- more painful than

## Bleeding

Source: https://www.nhs.uk/conditions/sepsis/ and the wound guidance above; bleeding
that will not stop is a 999 symptom on both. Blood appearing where it did not before
is what a Patient reports on the telephone, so that is what the phrases match.

- bleeding
- blood
- won't stop bleeding
- will not stop bleeding
- coughing up blood
- blood in the toilet
- blood when I

## Falls

Source: https://www.nhs.uk/conditions/falls/ — "Call 999 if you or someone else has
fallen and: may have injured the head, back, neck or hip; cannot get up", and "get
help from NHS 111 if you or someone else has fallen and may be in pain, injured or
unwell". Included because this workflow calls older patients specifically, and a fall
is the commonest thing they will volunteer.

- had a fall
- fell over
- fell down
- couldn't get up
- could not get up
- on the floor for
- lost my balance

## Thoughts of self-harm

Source: https://www.nhs.uk/mental-health/feelings-symptoms-behaviours/behaviours/help-for-suicidal-thoughts/
— "If you have seriously harmed yourself — for example, by taking a drug overdose — or
you feel that you may be about to harm yourself, call 999 for an ambulance or go
straight to A&E."

- end it all
- end my life
- kill myself
- harm myself
- hurt myself
- not want to be here
- don't want to go on
- do not want to go on
- no point going on
- taken too many

## Severe or worsening pain

Source: https://www.nhs.uk/conditions/sepsis/, which lists "muscle pain" among the
symptoms of sepsis in adults, and the wound guidance above ("become more painful").
Note the NHS wording is "muscle pain", not severe pain — the
severity words in the phrases below are ours, matching how a Patient describes pain
rather than how a page classifies it.

- worst pain
- agony
- unbearable
- screaming with
- getting worse and worse
- much worse since
