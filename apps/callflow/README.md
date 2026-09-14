# CallFlow

**Experimental lead-routing prototype with a mock CALL-E adapter**

## What it does
The prototype collects a small-business profile and models a lead follow-up
workflow. The current CALL-E service returns dummy success; real HTTP calling
is commented out. No working live-call integration or 60-second response
guarantee is claimed by this reference.

## Business types supported
- Coaching Centres
- Medical Clinics
- Salons
- Real Estate Agents
- Restaurants

## Proposed CALL-E integration
The intended adapter would use the CALL-E REST API with conversation scripts
per business type. The linked prototype currently simulates this boundary;
live intent, authorized destinations, credential handling and ambiguous-outcome
stopping would need verification before enabling real calls.

## Tech stack
- Frontend: Next.js 14, Tailwind CSS
- Backend: FastAPI, Python
- Database: Supabase
- Calls: mock adapter; CALL-E REST API integration proposed

## Links
- GitHub: https://github.com/shikhon-rahaman/callflow
- Demo video: (add after recording)
- Live demo: (add after deploying)

## Builder
Shikhon Rahaman — B.Tech CSE AI/ML student, 
Narula Institute of Technology, Kolkata
