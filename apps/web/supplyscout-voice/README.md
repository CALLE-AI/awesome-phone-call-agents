# SupplyScout Voice

**The procurement agent for businesses whose supplier data still lives on the phone.**

SupplyScout Voice helps small businesses source urgent parts by turning supplier phone calls into a structured procurement workflow.

## Problem

A repair shop looking for an urgent part often has to manually call several suppliers to ask about:

- exact part reference
- stock
- price
- warranty
- pickup availability
- delivery
- condition

SupplyScout turns those conversations into structured quotes while keeping a human in control.

## How CALL-E is used

CALL-E performs the actual outbound supplier phone calls.

SupplyScout:

1. prepares a structured call task;
2. requires explicit human approval;
3. dispatches the call through CALL-E;
4. stores the CALL-E provider call ID;
5. polls the call until terminal status;
6. normalizes returned supplier facts;
7. preserves missing facts as Unknown instead of inventing them.

A controlled production validation call to CALL-E's official US hackathon test hotline successfully reached `completed` status.

## Safety

- explicit human approval before outbound calls
- strict recipient allowlist
- E.164 validation
- idempotent call attempts
- separate reservation approval
- no autonomous payment or purchase
- uncertain facts remain uncertain
- credentials stay server-side
- fake mode available for safe demos

## Demo

Demo scenario: sourcing one alternator for a 2019 Renault Clio, budget €180, needed today.

## Links

- Live app: https://supplyscout-voice.vercel.app
- Source: https://github.com/NOUAIM98/supplyscout-voice

## Stack

Next.js, TypeScript, FastAPI, Python, LangGraph, PostgreSQL, pgvector, FastEmbed, Supabase, Railway, Vercel, and CALL-E.
