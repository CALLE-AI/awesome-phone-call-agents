# JobRadar Voice

JobRadar Voice is an AI-powered phone-call agent that helps discover hidden local job opportunities by calling approved employers, collecting structured hiring information, and matching it with candidate preferences.

## How it works

1. Candidate enters profile and preferred role.
2. JobRadar selects an approved employer.
3. CALL-E places a live AI phone call.
4. The agent collects:
   - Hiring status
   - Number of openings
   - Salary
   - Shift
   - Experience
   - Required skills
   - Joining timeline
   - Candidate referral permission
   - Future follow-up permission
5. The live conversation is parsed into structured hiring data.
6. JobRadar shows verified hiring signals and candidate matches.

## Language support

The AI agent first asks the employer to choose English or Hindi.

- English selected → full conversation continues in English.
- Hindi selected → full conversation continues in Hindi.
- Hinglish can be used when explicitly requested.

## Safety

- Calls are made only to approved or authorized test employers.
- The AI clearly identifies itself.
- Permission is requested before continuing.
- No protected or discriminatory questions are asked.
- Missing information is not intentionally fabricated.
- Employer opt-out is respected.
- Candidate profile sharing requires consent.
- Phone numbers and credentials should be stored using environment variables.

## Setup

Create a virtual environment:

```bash
python -m venv .venv
## Problem

Many small and local businesses hire through referrals, direct calls, or word of mouth instead of posting jobs online. Because of this, job seekers can miss nearby opportunities even when employers are actively hiring.

## Solution

JobRadar Voice converts offline hiring conversations into structured job data using a live AI calling agent powered by CALL-E.

## Architecture

Candidate Profile  
↓  
Approved Employer  
↓  
CALL-E Voice Agent  
↓  
Live Employer Conversation  
↓  
Transcript / Call Result  
↓  
Structured Hiring Data  
↓  
Matching Engine  
↓  
Candidate Consent  
↓  
Employer Follow-up

## Tech Stack

- Python
- Streamlit
- CALL-E
- SQLite
- Pytest
- python-dotenv

## Local Setup

Activate virtual environment on Windows:

```powershell
.\.venv\Scripts\Activate.ps1