# RelayMe Examples

All examples run with no CALL-E credentials and place no real call. They use the
fictional Maple Street Pharmacy task in `assets/sample-task.json` and a
standards-reserved example number.

## Example 1: A clear answer

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock --thread
```

The agent reaches the pharmacy, asks the one authorized question, and the user
reads the thread ending in a confirmed answer:

```
    You: Is the prescription under the name Jordan Rivera ready for pickup?
RelayMe: I'll call Maple Street Pharmacy, say I'm an AI assistant calling for you...
  Agent: Is the prescription for Jordan Rivera ready for pickup?
   Them: Yes, ready at the pickup counter, any time before 8 PM.
RelayMe: Here's your answer:
RelayMe: Yes. It's ready at the pickup counter, any time before 8 PM today.
```

Result: `outcome: answered`.

## Example 2: An unsure answer is never a confirmed yes

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock \
  --fixture apps/python/relayme/fixtures/hedged.json --thread
```

The person says "I think so, I can't be sure." RelayMe returns `outcome: partial`
with an empty `answer`. The user is told a person may need to follow up. A hedge
is never upgraded into a fact.

## Example 3: Voicemail leaves no private details

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock \
  --fixture apps/python/relayme/fixtures/voicemail.json --thread
```

Result: `outcome: voicemail`, no answer surfaced, and the thread explains the line
was closed. No sensitive details are left on a machine.

## Example 4: Wrong number stops immediately

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock \
  --fixture apps/python/relayme/fixtures/wrong_number.json --thread
```

Result: `outcome: wrong_number`. The agent apologises and ends the call without
asking the question, and the user is told to check the number.

## Example 5: Feed the web view

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock \
  --emit-thread-json /tmp/relayme-thread.json
```

Open `apps/python/relayme/web/relayme.html` in a browser and load
`/tmp/relayme-thread.json` with the file picker to see the thread rendered as an
accessible chat view. The page also ships embedded demo scenarios so it opens
with zero setup.

## Example 6: Reserve-before-dial refuses a duplicate

Running the same task twice reuses the same `task_id`, so the second run is
refused rather than dialling again:

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock
# second run: "Refusing to dial: task relayme-demo-0001 already done"
```

## Live planning

Only after the user authorizes the specific call and `calle auth login` has
completed, the same task can be planned through the CALL-E CLI (planning is not
execution):

```
calle call plan --to-phone +15550000123 --goal "<reviewed goal text>" --language English --region US
```

Run `--execute` only when the user separately confirms.
