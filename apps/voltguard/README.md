# 🛡️ VoltGuard: L2 Voice Escalation for Hardware Safety

VoltGuard is a "Human-in-the-Loop" safety architecture designed for high-voltage DC systems (such as hybrid solar arrays and heavy battery storage). It prevents dangerous automated hardware resets by forcing a strict voice-escalation protocol. 

## ⚠️ The Problem
In automated energy systems, blind resets of tripped high-voltage DC contactors can be lethal to technicians inspecting the wiring. SMS alerts are easily missed in the field. 

## 💡 The Solution
VoltGuard acts as a mandatory checkpoint. When a voltage anomaly is detected, the hardware physically locks out and triggers an L2 voice escalation via the Call-E AI. The system refuses to re-energize the grid until the AI secures explicit, verbal clearance from a human safety officer.

## ⚙️ Architecture & Tech Stack
* **Hardware Monitoring:** C++ / ESP32 (Simulated via Wokwi)
* **Webhook Bridge:** Node.js / Express.js
* **Voice Escalation:** Call-E API 
* **State Management:** JSON / REST

## 🚀 How it Works
1. **Fault Detection:** The microcontroller detects a critical voltage drop and fires a webhook to the local Node server.
2. **AI Escalation:** The server triggers the Call-E AI to dial the designated technician's phone number.
3. **Verbal Authorization:** The AI asks the technician to verbally confirm the perimeter is clear.
4. **Hardware Unlocked:** The conversational response is parsed into a structured JSON token (`authorized: true`) and routed back to unlock the hardware reset sequence.

---
*Built for CALL-E Hackathon using the Call-E SDK.*
