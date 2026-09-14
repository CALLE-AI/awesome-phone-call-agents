# 🌍 Co-Runner: AI Call Assistant for Frictionless Global Commerce

**Empowering international travelers to scale business operations across borders—completely removing language barriers without compromising deal execution.**

---

## 💡 The Problem & Vision
For international business travelers and cross-border entrepreneurs, language barriers are expensive. Missing a critical inventory confirmation, miscommunicating a reservation time, or failing to verify local store operational hours can stall supply chains and ruin business relationships. 

**Co-Runner** bridges this gap. It provides an intuitive, web-based control dashboard that allows global travelers to instantly deploy fluent, localized AI voice agents to make real-time business calls anywhere in the world. By handling the interaction in the local recipient's native language while dynamically streaming structured, English-translated evidence back to the traveler, business never has to compromise.

## 🛠️ Key Capabilities & Features
- **Smart Localization Matrices:** Dynamically maps target global languages (English, Hindi, German, Spanish, French, Japanese) directly to their respective E.164 country codes and regions (+91, +49, +34, etc.) to prevent user formatting errors.
- **Pre-baked Query Templates:** Instant action chips for high-frequency business tasks like *Store Hours tracking*, *Reservation booking*, and *Stock checks*.
- **Asynchronous Lifecycle Polling:** Seamlessly monitors long-running CALL-E call cycles via state synchronization (`completed`, `failed`, `canceled`) to report verified downstream events.
- **Resilient Regional Fallbacks:** Built-in network logic catches connection timeouts after 90 seconds, intelligently warning the traveler if high-congestion or regional carrier restrictions (such as current local limits in India) are delaying the agent's connection.
- **Cross-Lingual Evidence Extraction:** Forces downstream voice agents to conduct calls natively while standardizing all output logs into structured English evidence fields for consistent record-keeping.
- **Zero-Server Client Architecture:** Utilizes secure browser local storage for persistent history logging without requiring external database dependencies.

---

## 📁 Repository Structure
```text
📁 apps/typescript/co-runner-call-e/
├── 📄 index.html           # Consolidated UI layer containing all semantic HTML and design layouts
├── 📄 apps.js             # Core calling engine orchestrating CALL-E REST APIs & polling loops
├── 📄 config.example.js   # Template file for secure API credential injection
├── 📄 .gitignore           # Guardrail file preventing the exposure of private environment keys
└── 📄 README.md            # Authoritative project documentation and architectural deep dive
```

---

## 🚀 Quick Start & Installation

### 1. Prerequisites
You only need a web browser and a valid **CALL-E Developer Account** with API credentials.

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
BASE_URL: "https://heycall-e.com" // Pinned to the official CALL-E production API gateway
};
   ```

### 3. Launching the App
Because Co-Runner is an optimized client-side application, you don't need to install heavy backend modules:
1. Double-click `index.html` to open the interface in any modern web browser.
2. Select your destination language, type the recipient's phone number, select a template, and deploy your voice agent!

---

## ⚠️ Known Limitations

- **API key is client-side.** This is a browser app — the key in `config.js` is visible to anyone who opens dev tools on your machine. It's gitignored so it never reaches the repo, and requests are origin-allowlisted, but a real production version of this would route calls through a backend so the key never reaches the browser at all.
- **`localStorage` is not secure storage.** Call history isn't encrypted and isn't a secret store. Phone numbers are masked in the UI, but this is not a substitute for a real database with access controls.
- **No cancellation endpoint.** CALL-E's public API reference doesn't document a way to cancel/stop an in-progress call, so there's no "hang up" button here — a stuck call has to be checked on CALL-E's own dashboard.
- **Language selection is a request, not a guarantee.** Setting a locale tells the agent which language to attempt; it doesn't guarantee flawless execution. Always check `task_completed` on the response rather than assuming success.
- **Not built for high-stakes or urgent use.** Outcomes aren't guaranteed, calls can fail or time out, and there's no cancellation path — this is not suitable for emergencies or time-critical calls.
- **Billing is flat-rate, not duration-based.** Per CALL-E's current pricing, each billable call costs a flat rate regardless of length — this app doesn't (and can't meaningfully) optimize cost by ending calls early.
