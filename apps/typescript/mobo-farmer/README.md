# MoboFarmer & CALL-E: The Voice-Powered Engine for African Agriculture

## The Problem: The Invisible Cost of Smallholder Farming
For smallholder farmers in South Africa and across the continent, logistics and communication are massive bottlenecks. A farmer looking for input supplies (like seed, fertilizer, or diesel) or trying to find market prices can spend an entire morning calling 5 to 10 different cooperatives, buyers, or municipal offices. 

This manual process costs precious time, airtime, and often requires expensive taxi rides to physically verify stock or negotiate deals. Market access is the #1 hurdle to profitability.

## The Solution: MoboFarmer
MoboFarmer is a comprehensive digital dashboard built specifically for African smallholder farmers. It provides crop inventory tracking, water allocation management, and farm-level analytics. 

But a dashboard alone doesn't solve the core communication bottleneck. **That's where CALL-E becomes the engine of the application.**

## CALL-E: The Autonomous Communication Engine
MoboFarmer integrates autonomous voice AI agents via the **CALL-E** SDK to do the heavy lifting of farm communication. Instead of the farmer spending 3 hours on the phone, they type a natural language request into the app:
> *"Need 50 bags of L33 maize seed near Bothaville, ask for price and delivery."*

MoboFarmer dynamically spins up a CALL-E agent tailored with a specific "Skill" (Prompt + JSON Extraction Schema) to execute the task autonomously over the phone.

### The 3 Core Agents

#### 1. The Input Sourcing Agent
- **The Task:** Calls agricultural cooperatives (e.g., Afgri, OVK) to check stock availability, pricing, and delivery dates for specific seeds or fertilizers.
- **The Value:** Saves the farmer hours of calling around. The agent parses the conversation and returns a structured result (e.g., *R875/bag, 60 in stock*) directly to the MoboFarmer dashboard.

#### 2. The Market Linker Agent
- **The Task:** Calls fresh produce markets or local buyers to ask what grades of produce they are accepting, their current price per kg, and payment terms.
- **The Value:** Empowers the farmer with real-time market data to negotiate better prices before ever loading their truck. (This also creates a commercial viability model for the app by charging buyers for qualified leads).

#### 3. The Water & Service Coordinator Agent
- **The Task:** Calls the local Water User Association to confirm irrigation schedules, or calls local service providers (vets, transporters) to book appointments.
- **The Value:** Closes the loop. Inputs, Markets, and Services are all handled autonomously, turning a 3-hour administrative burden into a 30-second automated task.

## The Architecture
MoboFarmer orchestrates this using an **Asynchronous Polling Automation Pattern**. 
1. The Next.js backend dynamically constructs the prompt based on the farmer's intent.
2. It triggers `calleClient.calls.create()` to launch the call on the CALL-E telephony network.
3. The frontend asynchronously polls the server until the call completes, ensuring smooth operation without serverless timeout limits.
4. The extracted JSON data and the full conversation transcript are persisted to Firebase Firestore and displayed to the farmer in an intuitive, actionable format.

MoboFarmer doesn't just digitize farm records—it actively works the phones on behalf of the farmer.
