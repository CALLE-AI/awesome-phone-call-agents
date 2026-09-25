# BridgeCalle — Senior Voice Companion App

> **Category:** Apps / TypeScript / Healthcare & Elder Care  
> **Platform:** CALL-E REST API & SDK  
> **Author:** BridgeCalle Team  

## Overview
**BridgeCalle** is a senior-accessible web application built for CALL-E. It turns CALL-E voice agent technology into a prompt-guided active listening companion for elderly loved ones.

### Features
- **1-Tap Photo-First Preview:** Large avatar cards with photo upload; clicking a photo or name requests a no-call preview from the local backend. This browser interface does not send live-execution flags.
- **Prompt-Guided Active Listener Persona:** Task instructions instruct the AI to speak sparingly (short 1-2 word verbal nods) so seniors hold 90-95% of the conversation.
- **Call Summaries & WhatsApp Export:** Logged call entries with start times, durations, masked phone numbers, and 1-tap WhatsApp summary export.
- **Local Persistence:** Saves profiles, photos, and settings locally in browser `localStorage`.
- **Masked Numbers & XSS Prevention:** Phone numbers are masked in user-facing logs (`+1 *** *** 0000`), and summaries use HTML escaping.

---

## Quick Start

### 1. Install Dependencies
```bash
pnpm install # or npm install
```

### 2. Configure Environment
Set `CALLE_API_KEY` in environment (server-side only; never committed to git):
```bash
export CALLE_API_KEY="your_calle_api_key_here"
```

### 3. Run Application
```bash
npm start
```
Open `http://localhost:3000` in your browser.

---

## Side Effects & Dry-Run Mode
- Live network execution requires server-side `CALLE_API_KEY` and a separately configured `OPERATOR_KEY` (or `OPERATOR_SECRET`). The operator must send the matching `x-operator-key` header (or `operatorKey` body field), `execute: true`, and `confirmOptIn: true` for each authorized E.164 destination. No Host header or local address bypasses this check. Keep the operator secret private; never bundle it into browser source.
- When `CALLE_API_KEY` is not set or execution confirmation is omitted, the app operates safely in a **dry-run preview mode** (no network call placed).
- An accepted provider call may continue after the page or local server closes. An unknown live response is not proof that no call was placed; reconcile it with the provider before submitting another request.
