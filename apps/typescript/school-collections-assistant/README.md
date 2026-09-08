# School Payment Assistant

CALL-E payment follow ups for schools.

School Payment Assistant uses CALL-E voice calls to contact parents or guardians about outstanding school payments, have a polite conversation with them, and return a structured summary of the conversation.

## Problem

Schools often spend significant time manually following up with parents about unpaid school fees.

This usually involves:

* Calling parents individually
* Sending repeated reminders
* Tracking payment commitments manually
* Following up when promised payments are not made

School Payment Assistant automates the first payment follow up while keeping the conversation polite and human-friendly.

## How It Works

```text
School Admin
     │
     ▼
Web Dashboard
     │
     ▼
Express API
     │
     ▼
CALL-E
     │
     ▼
Parent / Guardian
     │
     ▼
AI Conversation
     │
     ▼
Structured Call Result
```

The school administrator provides:

* Parent/guardian name
* Student name
* Phone number
* Outstanding amount
* Payment due date
* School name

The application sends this information to CALL-E, which handles the phone conversation.

After the call, the application displays information such as:

* Whether the parent was aware of the outstanding payment
* Whether they intend to pay
* Expected payment date
* Call status
* Task completion status
* AI confidence
* Parent response

## Example

A school administrator enters:

```text
Parent: John Banda
Student: Mary Banda
Outstanding amount: K2,500
Due date: 30 September 2026
```

The CALL-E calls the parent and politely explains the outstanding payment.

It can then determine something like:

```json
{
  "payment_awareness": "yes",
  "will_pay": "yes",
  "payment_date": "2026-09-15",
  "parent_response": "The parent confirmed that they will make the payment on 15 September."
}
```

## Features

* CALL-E powered phone calls
* Automated payment reminders
* Structured conversation results
* Payment commitment tracking
* REST API
* CALL-E integration
* Automated API tests

## Tech Stack

### Frontend

* HTML
* CSS
* JavaScript

### Backend

* Node.js
* Express.js
* `@call-e/calle`

### Testing

* Vitest
* Supertest

## Project Structure

```text
school-payment-assistant/
│
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── tests/
│   └── reminder.test.mjs
│
├── .env
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── server.mjs
```

## Requirements

* Node.js 18+
* npm
* A CALL-E API key

## Installation

Clone the repository:

```bash
git clone 
cd school-payment-assistant
```

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Add your CALL-E API key:

```env
CALLE_API_KEY=your_calle_api_key_here
```

## Running the Application

Start the application:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Running Tests

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

The tests validate the API without making real phone calls.

## API

### Start Payment Reminder

```http
POST /api/reminder
Content-Type: application/json
```

Example request:

```json
{
  "parentName": "John Banda",
  "studentName": "Mary Banda",
  "phoneNumber": "+12025550100",
  "amount": "K2,500",
  "dueDate": "2026-09-30",
  "schoolName": "ABC Private School"
}
```

Example response:

```json
{
  "success": true,
  "status": "completed",
  "taskCompleted": true,
  "completionConfidence": {},
  "structuredResult": {
    "payment_awareness": "yes",
    "will_pay": "yes",
    "payment_date": "2026-09-15",
    "parent_response": "The parent confirmed they will pay on 15 September."
  }
}
```

## Privacy and Security

The CALL-E API key must remain on the server.

Never expose the API key in:

* Frontend JavaScript
* HTML
* Git repositories
* Screenshots
* Client-side API requests

Store secrets in `.env` and make sure `.env` is included in `.gitignore`.

## Current Limitation

CALL-E outbound calling currently has regional availability limitations. In particular, outbound calls to Zambian numbers are currently not supported.

For development and demonstration, the application can therefore be tested using a supported destination number.

The application itself is designed to be provider-independent enough that another voice provider could be integrated in the future for Zambian numbers.

## Future Improvements

* School dashboard
* Parent/payment history
* Multiple payment reminders
* Scheduled calls
* Automatic follow-up calls
* SMS/WhatsApp reminders
* Payment commitment tracking
* Integration with school accounting systems
* Payment gateway integration
* Support for Zambian phone numbers
* Call analytics
* Multiple schools and user accounts
* Authentication and role-based access control

## Hackathon Goal

The goal of School Payment Assistant is to demonstrate how AI voice agents can automate repetitive administrative work for schools while keeping communication respectful and personalized.

## License

This project is built for hackathon and demonstration purposes.
