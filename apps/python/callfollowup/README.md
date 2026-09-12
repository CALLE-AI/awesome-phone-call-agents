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
├── app/
│   ├── main.py
│   ├── dashboard.py
│   ├── call_service.py
│   ├── config.py
│   ├── models.py
│   └── storage.py
├── data/
│   └── calls.json
├── tests/
├── .gitignore
├── README.md
└── requirements.txt

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
