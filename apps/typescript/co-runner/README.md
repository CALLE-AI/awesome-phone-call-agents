# 🌍 Co Runner: AI Call Assistant for Global Travelers

**An AI voice agent that places real phone calls on your behalf, in the recipient's own language — built on CALL-E's calling infrastructure.**

---

## 💡 The Problem & Vision

For international travelers and cross-border businesses, language barriers turn a simple phone call into a real obstacle — confirming store hours, checking stock, or booking a reservation is hard enough when nobody picks up, harder still when they don't speak your language.

**Co Runner** solves this by dialing out and having the actual conversation *in the recipient's own language*, then reporting back to you in plain English — no scripts, no pre-translated text being read aloud.

## 🛠️ Key Capabilities & Features

- **Language-to-region mapping:** Maps supported languages (English, Hindi, German, Spanish, French, Japanese) to the correct CALL-E region/locale codes and country dial prefixes, so the call is placed correctly the first time.
- **Query templates:** One-tap chips for common tasks — store hours, reservations, stock checks — alongside a free-text field for custom requests.
- **Asynchronous call lifecycle polling:** Polls CALL-E's `GET /v1/calls/{id}` until the call reaches a terminal state (`completed`, `failed`, `canceled`), rather than trusting the initial "accepted" response as success.
- **Deliberate timeout, not a silent hang:** If a call is still `queued`/`in_progress` after 90 seconds of polling, the app stops and reports it as unresolved — a clear signal to check the CALL-E dashboard, not a guess.
- **English evidence reporting:** Appends an explicit instruction to every task telling the agent to report findings back in English regardless of the language the call was conducted in, and displays that answer in a tappable "Reply Log" per call.
- **Client-only architecture:** No backend server — call history is kept in the browser's `localStorage`. (See **Known Limitations** — this is not a secure store.)
- **Destination confirmation:** Every dial requires explicit user confirmation of the exact number and language before the request is sent — nothing calls automatically.
- **Origin allowlisting:** API requests are only ever sent to the approved CALL-E host; a misconfigured `BASE_URL` is refused rather than silently leaking credentials elsewhere.

---

## 📁 Repository Structure

```text
├── index.html            # UI layout and styles
├── apps.js               # Call orchestration: CALL-E API calls, polling, history, validation
├── config.example.js     # Template for API credentials — copy to config.js, never commit config.js
├── .gitignore             # Ignores config.js so real credentials never reach git history
├── CALL-E.png             # Brand logo shown on the main menu
└── README.md              # This file
```
> Adjust the paths above if your repo nests these files under a subfolder.

---

## 🚀 Quick Start & Installation

### 1. Prerequisites
A modern web browser and a CALL-E developer account with API credentials from [dashboard.heycall-e.com](https://dashboard.heycall-e.com/account/api-keys).

### 2. Environment Configuration
```bash
cp config.example.js config.js
```
Then edit `config.js`:
```javascript
const CALLE_CONFIG = {
    API_KEY: "your_actual_calle_api_key_here",
    BASE_URL: "https://api.heycall-e.com" // must match exactly — requests to any other host are refused
};
```
`config.js` is gitignored on purpose — never commit it. Without it, the app still loads and is fully browsable in preview mode; only dialing is disabled.

### 3. Running the App
No build step or server required — open `index.html` directly in a browser, or serve the folder with any static file server (recommended, since some browsers restrict `fetch()` from `file://` origins).

---

## ⚠️ Known Limitations

Documented honestly rather than glossed over:

- **API key is client-side.** This is a browser app — the key in `config.js` is visible to anyone who opens dev tools on your machine. It's gitignored so it never reaches the repo, and requests are origin-allowlisted, but a real production version of this would route calls through a backend so the key never reaches the browser at all.
- **`localStorage` is not secure storage.** Call history isn't encrypted and isn't a secret store. Phone numbers are masked in the UI, but this is not a substitute for a real database with access controls.
- **No cancellation endpoint.** CALL-E's public API reference doesn't document a way to cancel/stop an in-progress call, so there's no "hang up" button here — a stuck call has to be checked on CALL-E's own dashboard.
- **Language selection is a request, not a guarantee.** Setting a locale tells the agent which language to attempt; it doesn't guarantee flawless execution. Always check `task_completed` on the response rather than assuming success.
- **Not built for high-stakes or urgent use.** Outcomes aren't guaranteed, calls can fail or time out, and there's no cancellation path — this is not suitable for emergencies or time-critical calls.
- **Billing is flat-rate, not duration-based.** Per CALL-E's current pricing, each billable call costs a flat rate regardless of length — this app doesn't (and can't meaningfully) optimize cost by ending calls early.
