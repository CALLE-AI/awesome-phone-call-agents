# asl-recognition

The web app for the ASL accessibility project. A Deaf or hard-of-hearing person sets up a profile once, then signs (camera) or types a short request such as "dentist Tuesday 3". The app turns it into a structured booking request, sends it to the [`signcall`](../signcall/README.md) workflow server, and shows progress, the approval screen and the outcome.

Start with the [project README](../README.md) for the big picture, all environment variables and the safety design. This file covers this app: how to run it, what is inside, and, in detail, **what the sign-recognition model can and cannot do**.

## Run it

```bash
cd apps/web/asl-accessibility
python3 -m venv .venv && source .venv/bin/activate     # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r asl-recognition/requirements.txt

cd asl-recognition
cp .env.example .env          # then fill in GEMINI_API_KEY
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Open <http://localhost:8000>. Run it from this folder: the checkpoint, label map and `static/` paths are relative. The browser only grants camera access on `localhost` or HTTPS.

The booking itself needs the workflow server from [`../signcall`](../signcall/README.md) on port 8001 (`BOOKING_WORKFLOW_URL`). Without it the app still works up to the "send" step.

| Variable | Meaning |
|---|---|
| `GEMINI_API_KEY` | Reads ID and insurance card photos, and turns the request text into availability. Without it, fill the profile in by hand; the request-parsing step fails. |
| `BOOKING_WORKFLOW_URL` | The signcall `POST /runs` URL, e.g. `http://localhost:8001/runs`. |
| `SIGNCALL_NOTIFY_SECRET` | Shared secret; must equal `SIGNCALL_NOTIFY_SECRET` in `signcall/.env`. Notifications without it are refused. |
| `GEMINI_MODEL` | Optional. Default `gemini-flash-latest`, with a fallback to `gemini-flash-lite-latest` when the model is overloaded (HTTP 429/503). |

Requirements: Python 3.11 or newer; `numpy<2` (pinned for the MediaPipe and PyTorch versions used). `torch` is a large download; the model runs fine on CPU.

## What the app does

1. **Profile setup (once per browser).** Photograph an ID and an insurance card (Gemini fills in what is visible, never guessing), or type the details. Add family members who can interpret. Saved in a local SQLite file; there is no login, a "user" is a random ID kept in the browser.
2. **A request.** Sign into the camera or type. The recognized words appear as a transcript the person can undo, clear and correct before confirming.
3. **Parsing.** Gemini resolves "Tuesday 3" to a real date and time using today's date and returns structured availability. The person checks it, chooses the appointment type, and says whether they already have an interpreter.
4. **Send.** The request is reshaped to signcall's input schema and posted to `POST /runs`.
5. **Progress, approval, outcome.** The page follows the run, shows a plain proposal (date, time, clinic, interpreter) for a yes or no, and then the result. "More details" holds rates, requirements and notes.
6. **Upcoming.** A list of booked future appointments, each with a Cancel button. The cancel needs the workflow server that made the booking to still be running; after it restarts, the person is told to contact the clinic directly.

The UI is deliberately short on text, because it is meant for people who may not want to read long English paragraphs.

## The sign model and its limits

**Read this before relying on the camera.** The recognizer is a small proof of concept. Typing is the reliable path.

### What it is

- **Input features.** MediaPipe Tasks (`HandLandmarker` and `PoseLandmarker` lite) run on every frame. Each frame becomes a 227-number vector: 33 pose landmarks and 21 landmarks per hand (x, y, z), plus two flags for whether the left and right hands were seen. Coordinates are shifted to the midpoint of the shoulders and divided by shoulder width, so the signer's distance from the camera matters less. No face landmarks are used.
- **Classifier.** A 2-layer bidirectional GRU (hidden size 128) with attention pooling and a linear head (`models.py`). Each clip is resampled to exactly 32 frames (`SEQ_LEN`).
- **Output.** A softmax over **85 labels**: the 26 letters `a`-`z`, and 59 words (listed below). The checkpoint `model_gru_best.pt` is a bare PyTorch `state_dict`; `label_map.json` maps label to index.
- **Live use.** The browser sends a JPEG frame about every 150 ms (roughly 7 frames per second) over a WebSocket (`/ws/stream`). The server extracts features per frame, `segmenter.py` cuts the stream into signs, and each segment is classified on its own.

### Vocabulary (the complete list)

Letters: a b c d e f g h i j k l m n o p q r s t u v w x y z

Words: address, afternoon, appointment, april, call, doctor, ear, early, eight, eleven, february, five, four, friday, heartbody, hello, help, hospital, hour, insurance, interpreter, late, later, lungs, march, minute, monday, morning, name, night, nine, no, now, one, phone, please, ready, saturday, seven, six, sunday, ten, thankyou, three, thursday, time, today, tomorrow, tuesday, two, wait, wednesday, week, when, where, yes, yesterday, zero

The word list was chosen for booking an appointment (days, times, numbers, a few medical words). It is a fraction of what a real appointment conversation needs: it has only three months (February, March, April), no body parts beyond ear, lungs and `heartbody`, no symptoms, no clinic types such as "dentist" or "eyes", no "cancel", and no way to say a medicine or a person's name. A person's name, address and insurance details are not signed at all; they come from the profile.

### Why it is so limited

- **Trained on isolated words, not on signing.** The training data is dictionary-style: one short clip per sign, a person's hands rise, perform a single sign and drop. The model learned to tell 85 such clips apart. It has never seen two signs in a row, fluent signing with the blending between signs (co-articulation), or a sentence. Continuous sign-language recognition is a separate research problem that needs sentence-level data and a different model; this project does not attempt it.
- **Small vocabulary.** The project's data pipeline targeted a domain subset of about 90 words from a public dataset of roughly 2,200 isolated words (the `akasheroor/American-Sign-Language-Dataset` collection on Hugging Face, about 108,000 clips). Downloading and training on the whole set was not feasible on the available time and hardware, so a subset with a capped number of clips per word was used.
- **Few examples per word, few signers.** With a cap on clips per word, and dictionary-style data that typically has few signers per sign, the model sees little variation in hand size, signing speed, lighting, camera angle and clothing. Real webcam conditions differ from the studio-like clips it learned from, so accuracy on a new person in a new room is expected to be well below what a clean test split would show.
- **No recorded accuracy.** No held-out evaluation, confusion matrix or per-word accuracy was recorded with this checkpoint, and the training code is not in this repository. **Do not assume any particular accuracy.** Treat every word as a suggestion the person must verify.
- **It always answers.** The classifier returns the most likely of the 85 labels for any segment, including a hand that is only moving or resting, a sign that is not in the vocabulary, or a different signer's different sign. The confidence number is shown in the UI ("Last sign ... % confident"), but there is no rejection threshold, so a wrong word with a confident-looking score is possible. As a sanity check, feeding the checkpoint 20 frames of random numbers returns the letter `c` at about 90%.
- **Letters are single frames of a hand shape.** Fingerspelling is classified one letter at a time, and some letters depend on motion (j, z) or look nearly identical (m, n, s, t, e, a). Spelling out a name this way is error-prone and is not used for names in the booking flow.
- **Segmentation is a heuristic.** `segmenter.py` starts a segment when a hand appears and ends it after 8 consecutive frames (about 1.2 s) with no hand visible. People who sign continuously, keep their hands in view between signs, or pause mid-sign get words merged or split. The thresholds were chosen for the ~7 fps capture rate and were not tuned across signers or cameras. The tuning guide is in the module docstring.
- **Single signer, one person in frame, upper body visible.** MediaPipe pose is configured for one person. Both hands should be visible and the shoulders in frame (the features are normalised to them).
- **Non-manual signals are ignored.** Facial expression, head movement and mouth shapes carry grammar in ASL (questions, negation, intensity). The model sees none of it.
- **Handedness.** Left- and right-handed signers produce mirrored features. Whether the checkpoint was trained with mirror augmentation was not recorded, so assume a left-handed signer will do worse.
- **Regional and personal variation.** ASL varies by region, age and signer, and one dictionary clip per sign cannot cover that.

### What this means in practice

Use the camera for the handful of vocabulary words above, one sign at a time with a clear pause and your hand out of view in between, then check the transcript before confirming. For anything else, type. Every word recognized lands in a visible transcript with undo and clear, and the transcript is confirmed by the person before it is parsed, so a bad recognition costs a retry rather than a wrong booking.

### Improving it

The useful directions are more signers and conditions per word, sentence-level (continuous) data with a CTC or transformer model, a held-out evaluation with per-word results, a rejection class and a confidence threshold, left/right-hand augmentation, and face landmarks. Training and dataset-preparation code is not part of this folder; `utils_landmarks.py` is the single source of truth for the feature layout, so any new model must be trained on exactly that 227-number layout, resampled with `sample_or_pad` to `SEQ_LEN` frames.

## Files

| Path | Purpose |
|---|---|
| `app.py` | FastAPI app: static UI, `/ws/stream`, Gemini endpoints, profile and booking storage, hand-off to signcall. |
| `infer.py` | Loads the checkpoint and classifies a feature sequence; the command line classifies a video file (`python infer.py --video clip.mp4`). |
| `models.py` | `BiGRUAttention`. |
| `utils_landmarks.py` | MediaPipe wrapper, the 227-number feature layout, normalisation, resampling. |
| `segmenter.py` | Splits the frame stream into one segment per sign. |
| `gemini_client.py` | Card reading and request parsing, with retry and a lighter fallback model. |
| `db.py` | SQLite: profiles and one row per booking. |
| `static/` | The single-page UI (plain HTML, CSS, JavaScript; no build step). |
| `model_gru_best.pt`, `label_map.json` | The trained checkpoint (about 2.5 MB) and its 85-label index. |
| `models/hand_landmarker.task`, `models/pose_landmarker.task` | Google MediaPipe model files, used unmodified. They can be re-downloaded from `storage.googleapis.com/mediapipe-models/` (`hand_landmarker/hand_landmarker/float16/latest/` and `pose_landmarker/pose_landmarker_lite/float16/latest/`) and are covered by MediaPipe's own license. |
| `data/app.db` | Created on first run; git-ignored. Holds real profile and booking data. |

## HTTP and WebSocket API

| Route | Purpose |
|---|---|
| `GET /health` | Whether the checkpoint is present. |
| `WS /ws/stream` | Client sends one JPEG per binary message. Server sends `{"type":"status","signing":bool}`, `{"type":"word","word":"...","confidence":0-1}` or `{"type":"error","message":"..."}`. |
| `POST /extract-card` | One card photo in, profile fields out. |
| `POST /parse-booking` | Transcript in, structured availability out. |
| `GET` / `POST /profile/{user_id}` | Read or save the profile. |
| `POST /submit-booking` | Reshape and forward to signcall; returns the run id and the plan text. |
| `GET /bookings/{run_id}?user_id=` | Progress, proposal, result; refreshes from signcall if a notification was missed. |
| `POST /bookings/{run_id}/confirm` | The person's yes or no to the proposal. |
| `POST /bookings/{run_id}/cancel` | Cancel a booked appointment. |
| `GET /appointments/upcoming?user_id=` | Booked future appointments. |
| `POST /notifications` | Receives signcall's events (its `SIGNCALL_NOTIFY_URL`). Requires the `X-Signcall-Secret` header. |

There is no user login. Browser requests are only accepted from this app's own `localhost` page (other origins get `403`), and notifications need the shared secret. This is a local demo server; do not expose it to a network.

## Privacy

The profile (name, phone, date of birth, address, insurance, family contacts) and booking records are stored unencrypted in `data/app.db`. Card photos are sent to Gemini for reading and are not stored by this app. Camera frames are processed in memory and not saved. Camera access is requested by the browser, and only on `localhost` or HTTPS.
