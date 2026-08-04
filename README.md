# ☎️ OnCall Hero — AI Phone Booking Agent

**OnCall Hero** is an autonomous AI booking assistant built on top of the **CALL-E SDK**. It allows users to automatically dispatch phone calls to service providers (such as clinics, auto repair shops, or salons) to inquire about, negotiate, and book appointment slots on behalf of customers.

---

## 🌟 Features

* **Autonomous Call Execution**: Uses `@call-e/calle` SDK `calls.createAndWait()` to handle out-of-band telephone conversations.
* **Smart Prompt Synthesis**: Dynamically constructs detailed conversation tasks with flexible constraint handling (preferred slots, fallback requests, special instructions).
* **Live Dashboard UI**: Clean Tailwind CSS web interface to dispatch booking agents and observe call progress/summaries in real time.
* **Structured Result Capture**: Returns structured execution status, task completion state, and detailed call summaries.

---

## 🏗️ Architecture & Stack

* **Backend**: Node.js, Express, `dotenv`, `@call-e/calle`
* **Frontend**: HTML5, Tailwind CSS (via CDN), Vanilla JavaScript
* **Telephony AI Provider**: CALL-E Platform

---

## 🚀 Quickstart & Setup

### Prerequisites

* Node.js (v18+ recommended)
* A valid **CALL-E API Key** (obtainable from your CALL-E dashboard)

### 1. Installation

From the `apps/typescript/oncall-hero` directory, install the required dependencies:

```bash
npm install