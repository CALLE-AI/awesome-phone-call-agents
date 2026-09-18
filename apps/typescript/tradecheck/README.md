# TradeCheck 

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen.svg)](https://tradecheck-demo.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![AI SDK](https://img.shields.io/badge/Vercel_AI_SDK-latest-black)](https://sdk.vercel.ai/)

**TradeCheck** is an AI-powered Copilot that helps you verify international trade partners before you close a deal. It combines real-time documentary checks (government registries) with live AI voice calls (powered by Call-E) to ensure you are dealing with legitimate businesses.

## Live Demo

[<img src="/public/dashboard.png" alt="TradeCheck Live App" width="100%" style="border-radius: 12px; border: 1px solid #e5e7eb;">](https://tradecheck-demo.vercel.app)

👉 **[Launch TradeCheck Web App](https://tradecheck-five.vercel.app)** 👈


## Features

- **Conversational AI Copilot:** Natural language interface to gather trade deal requirements intuitively.
- **Documentary Checks (Government Registries):**
  - 🇮🇳 **India:** GSTIN verification via sandbox and live APIs.
  - 🇳🇬 **Nigeria:** CAC (Corporate Affairs Commission) registry lookup.
  - 🇬🇧 **UK:** Companies House direct API integration.
  - 🇨🇳 **China:** CNBizAPI integration.
  - 🇺🇸 **United States:** EIN/State-level entity verification.
- **Live Voice Verification:** Integrates with [Call-E](https://heycall-e.com) to place automated phone calls to suppliers. Verifies their identity, product availability, and quoted terms.

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router)
- **AI Integration:** [Vercel AI SDK](https://sdk.vercel.ai/) (`ai`, `@ai-sdk/react`, `@ai-sdk/google`)
- **LLM:** Google Gemini 
- **Styling:** Tailwind CSS

## Local Development

### Prerequisites

You will need the following API keys to run all verfication paths:
- `GEMINI_API_KEY` (Google Gemini)
- `CALLE_API_KEY` and `CALLE_BASE_URL` (Call-E)
- `COMPANIES_HOUSE_API_KEY` (UK Companies House)
- `RAPIDAPI_KEY` & `APIFY_API_KEY` (For Nigerian CAC checks)
- `SANDBOX_API_KEY` & `SANDBOX_AUTH_TOKEN` (GSTIN API for India)
- `CNBIZAPI_API_KEY` (China CNBizAPI)

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Favour-chuks/TradeCheck.git
   cd TradeCheck
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create an environment file and fill in your keys:
   ```bash
   cp .env.example .env.local
   ```
   *Edit `.env.local` with your actual API credentials.*

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. **Open the app:**
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

## Supported Verification Paths

1. **India (Sandboxapi):** Requires GSTIN number or Company Name and phone number.
2. **Nigeria (CAC):** Requires RC Number or Company Name, and phone number.
3. **United Kingdom (Companies House):** Requires Company Number or Name, and phone number.
4. **China (CNBizAPI):** Requires Company Name and phone number.
5. **United States (EIN/State Registry):** Requires Company Name or EIN, and phone number.

## License

This project is open-source and available under the [MIT License](LICENSE).
