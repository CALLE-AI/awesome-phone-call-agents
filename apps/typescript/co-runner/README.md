# 🌍 Co-Runner: AI Call Assistant for Frictionless Global Commerce

**Empowering international travelers to scale business operations across borders—completely removing language barriers without compromising deal execution.**

> **Demo-scope note:** The language and storage claims below describe what this app *attempts* to do, not a verified guarantee. See **Known Limitations** for what's actually qualified.

---

## 💡 The Problem & Vision

For international business travelers and cross-border entrepreneurs, language barriers are expensive. Missing a critical inventory confirmation, miscommunicating a reservation time, or failing to verify local store operational hours can stall supply chains and ruin business relationships.

**Co-Runner** bridges this gap. It provides an intuitive, web-based control dashboard that allows global travelers to instantly deploy AI voice agents that attempt the call in the local recipient's language, while streaming structured, English-translated evidence back to the traveler. Language selection is a request sent to CALL-E, not a guaranteed outcome — see Known Limitations.

---

## 🛠️ Key Capabilities & Features

* **Flexible Global Routing & Manual E.164 Entry:** Unlocks unrestricted international calling by allowing travelers to manually input any valid global E.164 destination number. Includes an interactive help badge (`!`) right next to the business phone field which, when touched, opens a pop-up notice confirming that the system supports international country codes including **+91, +49, +34, +33, and +81**.


* **Pre-baked Query Templates:** Instant action chips for high-frequency business tasks like *Store Hours tracking*, *Reservation booking*, and *Stock checks*.


* **Asynchronous Lifecycle Polling:** Seamlessly monitors long-running CALL-E call cycles via state synchronization (`completed`, `failed`, `canceled`) to report verified downstream events.


* **Deliberate Timeout, Not a Silent Hang:** If a call is still `queued`/`in_progress` after 90 seconds of polling, the app stops and reports it as unresolved rather than guessing or waiting indefinitely — a clear signal to check the CALL-E dashboard, not a bug.


* **Cross-Lingual Evidence Extraction:** Instructs the voice agent to conduct the call natively while standardizing all output logs into structured English evidence fields for consistent record-keeping.


* **Client-Only Architecture, With Masked Display:** No backend server — call history is kept in the browser's `localStorage` only. This is **not encrypted and not a secure secret store** (see Known Limitations); phone numbers are masked wherever they'd otherwise render as plain text (history, replies, confirmation prompts, and error messages).


* **Destination Authorization:** Every dial requires explicit confirmation of the (masked) number and language before the request is sent — nothing calls automatically.


* **Origin Allowlisting:** API requests are only ever sent to the approved [CALL-E host](https://api.heycall-e.com); a misconfigured `BASE_URL` is refused rather than silently leaking credentials elsewhere.



---

## 📁 Repository Structure

```text
📁 apps/typescript/co-runner/
├── 📄 index.html           # Consolidated UI layer containing all semantic HTML and design layouts
├── 📄 apps.js              # Core calling engine orchestrating CALL-E REST APIs & polling loops
├── 📄 config.example.js    # Template file for secure API credential injection
├── 📄 CALL-E.png            # Brand logo shown on the main menu
├── 📄 .gitignore            # Guardrail file preventing the exposure of private environment keys
└── 📄 README.md             # Authoritative project documentation and architectural deep dive
```

---

## 🚀 Quick Start & Installation

### 1. Prerequisites

You only need a web browser and a valid **CALL-E Developer Account** with API credentials from dashboard.heycall-e.com.

### 2. Environment Configuration

To keep credentials secure, this repository uses a decoupled configuration file.

1. Duplicate the example configuration file:
```bash
cp config.example.js config.js

```


2. Open `config.js` in your text editor and populate it with your official CALL-E credentials:


```javascript
const CALLE_CONFIG = {
    API_KEY: "insert_your_actual_developer_api_key_here",
    BASE_URL: "https://api.heycall-e.com" // must match the approved origin exactly — requests to any other host are refused
};

```



`config.js` is gitignored on purpose and must never be committed. Without it, the app still loads and is fully browsable in preview mode — only dialing is disabled until real credentials are added.

### 3. Launching the App

Because Co-Runner is an optimized client-side application, you don't need to install heavy backend modules:

1. Open `index.html` directly in any modern web browser (or serve the folder with any static file server — recommended, since some browsers restrict `fetch()` from `file://` origins).


2. Select your destination language, manually enter any valid international E.164 phone number, select a template, and deploy your voice agent!



---

## ⚠️ Known Limitations

* **API key is client-side.** This is a browser app — the key in `config.js` is visible to anyone who opens dev tools on your machine. It's gitignored so it never reaches the repo, and requests are origin-allowlisted, but a real production version of this would route calls through a backend so the key never reaches the browser at all.


* **`localStorage` is not secure storage.** Call history isn't encrypted and isn't a secret store. Phone numbers are masked wherever they render — history, replies, confirmation prompts, and error text — but masking a display is not the same as securing the underlying data; this is not a substitute for a real database with access controls.


* **No cancellation endpoint.** CALL-E's public API reference doesn't document a way to cancel/stop an in-progress call, so there's no "hang up" button here — a stuck call has to be checked on CALL-E's own dashboard.


* **Language selection is a request, not a guarantee of fluency.** Setting a locale tells the agent which language to attempt; it doesn't guarantee flawless execution or that the recipient will respond in kind. Always check `task_completed` on the response rather than assuming success from language selection alone.


* **Backend Server API Cross-Language Restrictions.** While the Co-Runner frontend allows flexible, manual input of any global E.164 phone number combined with any language selection, **the upstream CALL-E backend server API enforces strict telecommunication and localization validation**. Attempting cross-language combinations that mismatch a regional number's telecom market (e.g., trying to call an Indian `+91` number using Spanish) will cause task creation to be rejected directly by the server with errors such as: *"The phone number is recognized as India, but Spanish is not supported for calls to India."* To prevent this, ensure your chosen target language aligns with regionally supported carrier routes (such as English or Hindi for `+91`).
* **Not built for high-stakes or urgent use.** Outcomes aren't guaranteed, calls can fail or time out, and there's no cancellation path — this is not suitable for emergencies or time-critical calls.


* **Usage-based billing.** CALL-E charges a Call Fee plus a Success Fee when the task's defined business goal is achieved. Call usage is measured in 10-second increments; preparation and pre-connection costs may apply even when a call does not connect. See the [pricing FAQ](https://www.heycall-e.com/) and [Dashboard billing](https://dashboard.heycall-e.com/account/billing) for actual charges.
