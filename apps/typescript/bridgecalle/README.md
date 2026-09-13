# BridgeCalle — Senior Voice Companion App

> **Category:** Apps / TypeScript / Healthcare & Elder Care  
> **Platform:** CALL-E API & SDK  
> **Author:** BridgeCalle Team  

## Overview
**BridgeCalle** is a senior-accessible web application built for CALL-E. It turns CALL-E voice agent technology into an active listening companion for elderly loved ones.

### Features
- **1-Tap Photo-First Dialing:** Large avatar cards with photo upload; clicking anywhere on a photo or name immediately triggers a CALL-E phone call.
- **90/10 Active Listener Persona:** The AI speaks sparingly (1-2 word verbal nods) so seniors hold 90-95% of the conversation.
- **Call Summaries & WhatsApp Export:** Logged call entries with start times, durations, and 1-tap WhatsApp summary export.
- **Local Persistence:** Saves profiles, photos, and settings locally in browser `localStorage`.

---

## Quick Start

### 1. Install Dependencies
```bash
pnpm install # or npm install
```

### 2. Configure Environment
Set `CALLE_API_KEY` in environment:
```bash
export CALLE_API_KEY="iams_live_your_api_key_here"
```

### 3. Run Application
```bash
npm start
```
Open `http://localhost:3000` in your browser.

---

## Side Effects & Dry-Run Mode
- Clicking a card triggers a **real outbound call** via CALL-E's REST API (`POST /v1/calls`).
- If no `CALLE_API_KEY` is provided, the app operates in a preview/demo mode without placing network calls.
