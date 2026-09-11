
# CallGuard

AI Scam-Call Counter-Intelligence Agent powered by CALL-E.

## Overview

CallGuard investigates suspicious phone calls instead of simply identifying them.

The application uses CALL-E to make an authorized real phone call, conduct a short conversational investigation, collect the caller's responses, and analyze the conversation for potential scam patterns.

The result includes:

- Risk level
- Risk score
- Likely scam type
- Detected red flags
- Scam signature
- Safety recommendation
- Call summary
- Conversation transcript
- Reusable scam intelligence

## How It Works

```text
Suspicious phone number
        ↓
      CALL-E
        ↓
Real phone conversation
        ↓
    Transcript
        ↓
Speaker-aware analysis
        ↓
Risk assessment
        ↓
Scam signature
        ↓
Scam intelligence database
Example

A caller claiming to be from a bank may say that the recipient's KYC has expired and that verification must be completed immediately.

If the caller requests an OTP, CallGuard can detect indicators such as:

FINANCIAL_CONTEXT + KYC + OTP_REQUEST + URGENCY

The application can classify the conversation as high risk and provide a safety recommendation.

Features
1. Real Phone Investigation

CallGuard uses CALL-E to conduct a real outbound phone conversation.

2. Conversational Scam Analysis

The transcript is analyzed for behavioral indicators including:

Financial or bank references
KYC claims
OTP requests
Credential requests
Urgency
Payment requests
Remote-access requests
Threats
3. Risk Assessment

The analyzer produces:

Risk level
Risk score
Confidence
Likely scam type
Evidence indicators
4. Reusable Scam Signatures

Detected patterns are converted into reusable signatures.

Example:

FINANCIAL_CONTEXT + KYC + OTP_REQUEST + URGENCY

Repeated investigations with the same signature increase its occurrence count.

5. Scam Intelligence

CallGuard maintains a local database of discovered scam patterns so that recurring conversational patterns can be recognized.

Requirements
Node.js 18+
npm
CALL-E account
CALL-E CLI
Authorization to contact the phone number being investigated
Installation

Install the project dependencies:

npm install

Install and authenticate CALL-E using the official CALL-E installation instructions.

Verify the CLI:

calle --help

Then start CallGuard:

npm start

Open:

http://localhost:3000
Real Call Warning

CallGuard can place real outbound phone calls through CALL-E.

Only investigate phone numbers that you are authorized to contact.

Do not use this application to impersonate a bank, government agency, employer, or another organization.

CallGuard is intended for authorized security testing, research, and defensive use.

Sensitive Information

Never provide or request:

OTPs
Passwords
PINs
CVVs
Banking credentials
Remote-access credentials

CallGuard's investigation logic is designed to identify requests for sensitive information, not to collect those credentials.

Privacy

CallGuard's scam intelligence database stores reusable scam-pattern information rather than investigated phone numbers.

Stored information can include:

Scam signature
Scam type
Risk level
Risk score
Confidence
Occurrence count
Investigation summary

Investigated phone numbers are not persisted in scam intelligence records.

Dry-Run / Analysis Mode

The scam analyzer can process a supplied conversation transcript without placing a phone call.

This allows the analysis and scam-signature logic to be tested without triggering a real CALL-E call.

Project Structure
callguard/
├── public/
│   ├── app.js
│   ├── index.html
│   └── style.css
│
├── src/
│   ├── analysis/
│   │   └── scamAnalyzer.js
│   ├── calle/
│   │   └── calleService.js
│   ├── database/
│   │   └── scamDatabase.js
│   └── server.js
│
├── package.json
├── package-lock.json
└── README.md
Safety and Responsible Use

CallGuard is a defensive security project.

Use it only for legitimate investigations and authorized testing.

Do not harass, deceive, impersonate organizations, or attempt to obtain sensitive personal or financial information.

Always verify suspicious claims independently through official channels.
```
