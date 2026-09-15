# Lost & Found Caller

Lost & Found Caller is a CALL-E powered AI voice-agent application that helps users recover lost items by contacting lost-and-found departments on their behalf.

Instead of manually searching for phone numbers, making multiple calls, and repeatedly explaining what was lost, the user provides the item details and the application uses CALL-E to make the phone call and communicate with the lost-and-found staff.

## What it does

The application follows a simple workflow:

1. **Describe** — The user provides information about the lost item.
2. **Call** — CALL-E makes a real phone call to the selected lost-and-found location.
3. **Compare** — Information from the conversation is compared with the user's lost-item description.
4. **Recover** — The application presents an actionable recovery result.

The goal is to turn a manual phone task into an AI-assisted real-world action.

## Demo

A public demo is available at:

https://lost-and-found-caller-1.vercel.app/

The application includes a **Demo Mode** that allows reviewers to experience the complete workflow without placing a real phone call.

Available demo scenarios include:

- Backpack
- Umbrella
- Generic Bag

The demo shows the search workflow, conversation preview, simulated staff response, match confidence, and final recovery signal.

## Real CALL-E workflow

The application also supports the real CALL-E calling workflow.

When a real call is initiated, the lost-item information is passed to the server-side calling workflow. CALL-E then contacts the configured destination and communicates the relevant information to the lost-and-found staff.

The important part of this project is that the AI does not only generate text in the browser.

It actually performs a phone-based action in the real world.

## Architecture

```text
User
  ↓
Lost Item Information
  ↓
Next.js Application
  ↓
Server-side CALL-E Calling Workflow
  ↓
CALL-E Voice Agent
  ↓
Real Phone Conversation
  ↓
Call Result
  ↓
Recovery Signal
```
