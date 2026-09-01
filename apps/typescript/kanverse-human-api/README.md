# Kanverse Human API

**A goal-driven calling layer that turns phone-only real-world services into structured, callable workflows.**

Kanverse Human API uses CALL-E for individual phone calls while a CallChain orchestration layer manages the overall mission.

## Example

> Find a repair shop that can replace my phone screen tomorrow for under £80.

Human API can work through multiple authorized phone targets, evaluate the structured result of each CALL-E interaction, and stop when the user's goal is achieved.

## Flow

Goal → CALL-E Plan → Human Approval → Call → Evaluate → Continue or Stop

## Safety

- Dry Run is the default mode.
- Live mode must be deliberately enabled.
- Every real call requires explicit user confirmation.
- Changing execution mode invalidates the existing plan.
- Phone numbers are masked in the dashboard.
- Automatic orchestration never bypasses approval for a real call.

## CALL-E integration

The prototype integrates CALL-E planning, execution, and status retrieval.

A real outbound CALL-E test validated the complete lifecycle:

Plan → Confirmation → Real Call → Status → Transcript → Structured Outcome → Next-Step Decision

## CallChain

If a call does not satisfy the goal, Human API prepares the next target for user confirmation.

If a structured outcome satisfies the goal, the chain stops with **GOAL ACHIEVED**.

This separates responsibilities:

**CALL-E handles the call. Human API handles the mission.**

## Running the prototype

Requirements:

- Node.js
- npm
- CALL-E CLI
- Authenticated CALL-E account

Install and start:

    npm install
    npm start

On Windows PowerShell systems where `.ps1` wrappers are blocked:

    npm.cmd install
    npm.cmd start

Then open:

    http://localhost:3000

Use **Dry Run** for no-call testing.

Real calls create external side effects and consume CALL-E call capacity. Enable Live mode only when you intend to place a call, and review each CALL-E plan before confirming it.

## Technology

- JavaScript
- HTML / CSS
- Node.js
- Express
- CALL-E

## Project

Created for the CALL-E “Your Code Is Calling” Hackathon.

**Human ↔ Machine ↔ World**
