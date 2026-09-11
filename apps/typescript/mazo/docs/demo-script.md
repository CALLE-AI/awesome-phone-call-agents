# Mazō — 2-Minute Demo Video Script
*CALL-E Hackathon Submission Video Guide*

---

## 🎬 Video Structure Overview
- **Total Duration:** ~120 seconds (under 3-minute limit)
- **Format:** Screen recording with voiceover (Loom / OBS / Screen Studio)
- **Goal:** Hook the judges in the first 15 seconds, demonstrate real CALL-E telephony, showcase automated task extraction, and close with the core philosophy.

---

### [0:00 – 0:25] The Hook: The Passivity Problem
**Visual:** Show an empty to-do app or closed laptop screen, then cut to the Mazō terminal or mobile app.
**Voiceover:**
> "Every productivity app in the world shares the same fatal flaw: they are completely passive. When you're overwhelmed, procrastinating, or stuck in decision paralysis, you don't open your to-do app, and you definitely don't type essays to an AI chatbot.
> 
> Meet Mazō. Mazō flips the equation: **When you need momentum, Mazō calls your phone.**"

---

### [0:25 – 0:55] Running the Safe Dry-Run & Unit Tests
**Visual:** Terminal showing `apps/typescript/mazo`. Run `npm test`, then run `node mazo-coach.js`.
**Voiceover:**
> "Mazō is contributed as a standalone autonomous coaching agent in the CALL-E ecosystem. 
> 
> First, safety is our priority. We run 12 comprehensive unit tests covering international E.164 phone sanitization, PII masking, and structured schema verification.
> 
> By default, running Mazō operates in a 100% safe dry-run mode with zero phone charges. In seconds, it compiles a personalized coaching goal for our client, Omar, engages in a bounded 3-minute session with coach 'The Clarifier', and extracts structured action items with hard deadlines directly into our schedule."

---

### [0:55 – 1:35] The Live Voice Experience & Real-Time Extraction
**Visual:** Show live dialing (`node mazo-coach.js --live` or the Mazō mobile incoming call modal in `Mazonew-1`). The phone rings, answer, and show the voice visualizer.
**Voiceover:**
> "Now let's see what happens when Mazō calls for real. 
> 
> *(Demonstrate the phone ringing or incoming call modal)*
> 
> Mazō doesn't do open-ended small talk. It follows a strict 4-phase protocol:
> 1. It triages your immediate bottleneck.
> 2. It challenges your excuses and strips overthinking.
> 3. It locks in ONE concrete action block.
> 4. And it hangs up with the instruction: 'Put down the phone and go execute.'
> 
> The moment the call concludes, CALL-E's transcript is analyzed by GPT-4o, converting our spoken words into verified tasks, scheduled calendar blocks, and accountability alarms."

---

### [1:35 – 2:00] Closed-Loop Follow-Up & Conclusion
**Visual:** Run `node mazo-coach.js --mode followup`. Show the milestone verified, +25 XP awarded, and streak maintained.
**Voiceover:**
> "And Mazō doesn't forget. At 5:00 PM, Mazō triggers a closed-loop follow-up verification call: 'Did you ship the API build?' Once confirmed, it reconciles the milestone, awards momentum XP, and preserves your execution streak.
> 
> Mazō turns overthinking into decisive action. Because real progress happens when you put down the screen and execute.
> 
> Thank you!"
