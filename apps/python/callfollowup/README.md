# CallFollowUp

### AI-powered business follow-ups that turn conversations into actionable next steps.

CallFollowUp is a Streamlit application that helps small businesses manage customer follow-up calls using the CALL-E phone-call API.

Instead of manually making follow-up calls and writing notes afterward, CallFollowUp sends the follow-up task to CALL-E, captures the conversation result, and turns it into structured business information such as the outcome, notes, next action, and callback time.

## Features

- Create customer follow-up records
- Enter a contact name, phone number, and call goal
- Preview a follow-up before making a real call
- Make outbound calls using CALL-E
- Wait for the call to complete
- Extract structured results from the conversation
- Store follow-up history locally
- Display call outcome, notes, and next action
- Display callback information when available
- View the CALL-E conversation transcript
- Simple Streamlit dashboard for tracking follow-ups

## How It Works

```text
Business user
     |
     v
Create follow-up
     |
     v
CallFollowUp
     |
     v
CALL-E outbound call
     |
     v
Customer conversation
     |
     v
Structured call result
     |
     +----> Outcome
     +----> Notes
     +----> Next action
     +----> Callback time
     |
     v
CallFollowUp dashboard

# Technology #
*Python
*Streamlit
*CALL-E
*calle-ai Python SDK
*python-dotenv
*JSON storage

# Project Structure #
CallFollowUp/
â”œâ”€â”€ app/
â”‚   â”œâ”€â”€ main.py
â”‚   â”œâ”€â”€ dashboard.py
â”‚   â”œâ”€â”€ call_service.py
â”‚   â”œâ”€â”€ config.py
â”‚   â”œâ”€â”€ models.py
â”‚   â””â”€â”€ storage.py
â”œâ”€â”€ data/
â”‚   â””â”€â”€ calls.json
â”œâ”€â”€ tests/
â”œâ”€â”€ .gitignore
â”œâ”€â”€ README.md
â””â”€â”€ requirements.txt

# Setup #

Clone the repository:
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd CallFollowUp

Create and activate a virtual environment:
python3 -m venv .venv
source .venv/bin/activate

Install dependencies:
pip install -r requirements.txt

# Environment Variables #
Create a .env file in the project root:

CALLE_API_KEY=your_call_e_api_key
Never commit the .env file or expose your API key publicly.

# Run the Application #
From the project root:
PYTHONPATH=. streamlit run app/dashboard.py
Streamlit will provide a local URL where the CallFollowUp dashboard can be opened.

CALL-E Integration

CallFollowUp uses CALL-E to perform the actual outbound phone call.

The application sends:

The follow-up goal as the CALL-E task
The contact phone number as the recipient
A structured result schema for extracting the call outcome

The application then retrieves the completed call result and displays the conversation and structured follow-up information in the dashboard.

# Demo #

For testing the CALL-E integration, the project used the official CALL-E testing hotline.

The demo focuses on the complete workflow:

1)Create a follow-up
2)Prepare the call
3)Start the CALL-E call
4)Retrieve the completed call
5)Extract the structured result
6)Display the outcome and transcript
7)Save the follow-up in call history

The testing hotline is used only to demonstrate the integration and should not be represented as a real customer.

# Use Case #

CallFollowUp is designed for small businesses that regularly need to follow up with:

*Customer inquiries
*Service requests
*Leads
*Previous conversations
*Appointment-related requests
*Potential customers who need another contact

The goal is to reduce repetitive follow-up work while keeping the results organized and actionable.

# Safety #

Real phone calls can have external effects. The application therefore provides a preparation/dry-run workflow before initiating an actual CALL-E call.

API credentials are stored through environment variables and excluded from Git using .gitignore.

# Hackathon #

Built for the CALL-E:


## Safety & Behaviour

### Closing the UI does not cancel an accepted call

> **Important:** Closing, refreshing, or disconnecting from the Streamlit UI does **NOT**
> cancel a CALL-E call that has already been accepted by the provider.
> Accepted calls continue according to the CALL-E provider-side lifecycle.
> If you need to stop a call after submission, use your CALL-E dashboard directly.

### Preview is credential-free

The **Prepare Call** step performs only local validation and display.
No `CALLE_API_KEY` is required and no network request is made during preview.
`CalleClient` is instantiated only when the user explicitly starts a live call.

### Phone number validation

All phone numbers must be in **exact E.164 format**:
- Starts with `+`
- Followed by 1–15 digits
- First digit after `+` cannot be `0`
- No spaces, hyphens, or parentheses accepted

Examples of valid numbers: `+14155552671`, `+919876543210`

The same validation is applied before preview and again before every live CALL-E call.

### Remote credential-bearing deployments require authentication

If `APP_USERNAME` and `APP_PASSWORD` are set in the environment (or Streamlit Secrets),
or if `CALLE_API_KEY` is present on a non-private network, the dashboard requires
basic login before any functionality is accessible.

Local / loopback / private-network deployments without explicit credentials do not
require authentication.

### Sensitive provider output is masked

- Phone numbers are masked before storage (e.g. `+*******2671`).
- Phone numbers and email addresses in CALL-E transcripts are redacted automatically.
- Raw CALL-E / provider API responses are never displayed in the UI.
- Provider exceptions are caught and replaced with a safe generic message.
- `CALLE_API_KEY` is never printed, logged, or included in error messages.

### Ambiguous call creation becomes UNKNOWN

If an exception occurs during `calls.create()`, or if the provider does not return
a definitive call ID, the call status is set to **UNKNOWN**.

When status is UNKNOWN:
- The workflow **stops immediately**.
- The user is shown a reconciliation message.
- **No automatic retry is performed.**
- The user must check the CALL-E dashboard to confirm whether a call was accepted
  before attempting another submission.

This prevents duplicate calls caused by UI timeouts or transient HTTP errors.

### No automatic retry after ambiguous creation

Reconciliation and retry are separate, deliberate actions.
CallFollowUp never retries a call creation automatically.
