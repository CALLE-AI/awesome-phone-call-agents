import json
import random
import uuid
import time
import asyncio
from fastapi import FastAPI, Depends, HTTPException, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
import os

from config import (
    logger,
    MOCK_MODE,
    calle_client,
    WEBHOOK_URL,
    CALL_TIMEOUT_SECONDS,
    CALLE_CALL_RECIPIENT,
)
from database import init_db, get_db, Lead
from schemas import LeadCreate, LeadOut, WebhookEvent
from playbooks import get_qualification_playbook

# Initialize FastAPI App
app = FastAPI(
    title="CALL-E Lead Qualification Agent",
    description="Automated sales lead qualifier using CALL-E voice integrations.",
    version="1.0.0"
)

# Ensure Database is Initialized
init_db()

# Async Call Timeout Checker
async def check_call_timeout(lead_id: int, db_session_factory):
    """
    Waits CALL_TIMEOUT_SECONDS seconds and checks if the call status is still in progress.
    If no webhook has arrived to resolve it, auto-transitions status to "no_answer".
    """
    await asyncio.sleep(CALL_TIMEOUT_SECONDS)
    db = db_session_factory()
    try:
        lead = db.query(Lead).filter(Lead.id == lead_id).first()
        if lead and lead.status in ["calling", "pending"]:
            logger.info(f"Call timeout reached for lead {lead.id} ({lead.name}). Setting status to 'no_answer'.")
            lead.status = "no_answer"
            lead.notes = f"Call timed out: No webhook update received within {CALL_TIMEOUT_SECONDS} seconds."
            db.commit()
    except Exception as e:
        logger.error(f"Error in timeout checker for lead {lead.id}: {e}")
        db.rollback()
    finally:
        db.close()

# Async Live CALL-E Poller & Timeout Checker
async def poll_call_status(lead_id: int, db_session_factory):
    """
    Periodically polls the CALL-E API for the status of a live call.
    - If the call is answered (connected/in-progress), transitions status to "connected".
    - If the call is completed, updates status to "completed" and saves transcript.
    - If the call fails or times out, updates status to "failed" / "no_answer".
    - Automatically stops after CALL_TIMEOUT_SECONDS or when a terminal status is reached.
    """
    interval = 3  # Poll every 3 seconds
    elapsed = 0
    while elapsed < CALL_TIMEOUT_SECONDS:
        await asyncio.sleep(interval)
        elapsed += interval
        
        db = db_session_factory()
        try:
            lead = db.query(Lead).filter(Lead.id == lead_id).first()
            if not lead or lead.status in ["completed", "failed", "no_answer", "declined"]:
                break  # Already in a terminal state (from webhook or previous poll)
                
            if not lead.call_id or "mock" in lead.call_id:
                break  # Don't poll in mock mode
                
            try:
                # Poll CALL-E API asynchronously to avoid blocking FastAPI event loop
                call_payload = await asyncio.to_thread(calle_client.calls.get, lead.call_id)
            except Exception as api_err:
                logger.error(f"Error polling CALL-E API for lead {lead.id}: {api_err}")
                continue
                
            api_status = call_payload.get("status")
            
            # Extract transcripts if present
            turns = []
            recipients = call_payload.get("recipients", [])
            has_connected = False
            
            if recipients:
                recipient = recipients[0]
                attempts = recipient.get("attempts", [])
                if attempts:
                    attempt = attempts[0]
                    attempt_status = attempt.get("status")
                    turns = attempt.get("transcript_turns", [])
                    # If there's an active/connected attempt or any transcript turns, consider it connected
                    if attempt_status in ["connected", "in_progress", "completed", "answered"] or len(turns) > 0:
                        has_connected = True
            
            was_connected = has_connected or lead.status == "connected" or len(turns) > 0
            
            if api_status in ["completed", "failed"]:
                # The call has reached terminal state
                if api_status == "completed" or was_connected:
                    lead.status = "completed"
                else:
                    lead.status = "failed"
                    
                if turns:
                    lead.transcript = json.dumps(turns)
                
                # Extract Structured Outcome Results
                structured_result = call_payload.get("structured_result")
                if structured_result:
                    lead.pain_point = structured_result.get("pain_point")
                    lead.timeline_window = structured_result.get("timeline_window")
                    lead.budget_status = structured_result.get("budget_status")
                    lead.interest_level = structured_result.get("interest_level")
                    lead.handoff_recommended = bool(structured_result.get("handoff_recommended", False))
                    lead.notes = structured_result.get("notes")
                else:
                    lead.notes = call_payload.get("failure_message") or ("Call completed successfully." if was_connected else "No structured result extracted.")
                    if lead.status == "failed" and not was_connected:
                        failure_code = call_payload.get("failure_code")
                        if failure_code in ["no_answer", "no_human_answered"]:
                            lead.status = "no_answer"
                        elif failure_code == "declined":
                            lead.status = "declined"
                            
                db.commit()
                logger.info(f"Poller: Lead {lead.id} call finished with status: {lead.status}")
                break
                
            elif has_connected or api_status in ["in_progress", "connected"]:
                updated_transcript = json.dumps(turns) if turns else lead.transcript
                if lead.status != "connected" or lead.transcript != updated_transcript:
                    logger.info(f"Poller: Lead {lead.id} call connected / updated turns ({len(turns)} turns).")
                    lead.status = "connected"
                    if turns:
                        lead.transcript = updated_transcript
                    db.commit()
            
        except Exception as e:
            logger.error(f"Error in poller loop for lead {lead_id}: {e}")
            db.rollback()
        finally:
            db.close()
            
    # Timeout handling: if still calling or connected when poller finishes
    db = db_session_factory()
    try:
        lead = db.query(Lead).filter(Lead.id == lead_id).first()
        if lead and lead.status in ["calling", "connected", "pending"]:
            has_turns = bool(lead.transcript and len(json.loads(lead.transcript or "[]")) > 0)
            if lead.status == "connected" or has_turns:
                logger.info(f"Call completion reached for lead {lead.id} ({lead.name}). Setting status to 'completed'.")
                lead.status = "completed"
                if not lead.notes:
                    lead.notes = "Call completed successfully."
            else:
                logger.info(f"Call timeout reached for lead {lead.id} ({lead.name}). Setting status to 'no_answer'.")
                lead.status = "no_answer"
                lead.notes = f"Call timed out: No answer received within {CALL_TIMEOUT_SECONDS} seconds."
            db.commit()
    except Exception as e:
        logger.error(f"Error in timeout cleanup for lead {lead_id}: {e}")
        db.rollback()
    finally:
        db.close()


# Mock Simulation Background Worker
def simulate_mock_call(lead_id: int, db_session_factory):
    """
    Simulates a CALL-E conversation in mock mode.
    Phase 1: Updates status to "connected" after 2s (simulating user picking up call).
    Phase 2: Streams conversation turns live into DB turn-by-turn so the UI displays messages in real-time.
    Phase 3: Finalizes structured BANT scorecard metrics and marks status as "completed".
    """
    # Phase 1: Calling to Connected (User picks up call)
    time.sleep(2)
    db = db_session_factory()
    try:
        lead = db.query(Lead).filter(Lead.id == lead_id).first()
        if lead and lead.status == "calling":
            logger.info(f"Mock call: Lead {lead.id} ({lead.name}) connected.")
            lead.status = "connected"
            lead.transcript = json.dumps([])
            db.commit()
    except Exception as e:
        logger.error(f"Error simulating mock call connection: {e}")
        db.rollback()
    finally:
        db.close()

    # Phase 2: Live Conversation Streaming
    db = db_session_factory()
    lead_name = "Prospect"
    product_interest = "our solutions"
    try:
        lead = db.query(Lead).filter(Lead.id == lead_id).first()
        if lead:
            lead_name = lead.name
            product_interest = lead.product_interest or "our solutions"
    finally:
        db.close()

    profile = random.choice([
        {
            "pain_point": "Needs automated routing of support tickets to reduce staff workload.",
            "timeline_window": "1_3_months",
            "budget_status": "approved",
            "interest_level": "high",
            "handoff_recommended": True,
            "notes": "Highly qualified prospect. Currently using manual tools and ready to switch."
        },
        {
            "pain_point": "Wants to evaluate AI outbound calls for their real estate agency.",
            "timeline_window": "immediate",
            "budget_status": "pricing_out",
            "interest_level": "high",
            "handoff_recommended": True,
            "notes": "Immediate need. Looking to compare CALL-E against standard Twilio bots."
        },
        {
            "pain_point": "Just curious about voice tech, no active business problems.",
            "timeline_window": "longer_or_unknown",
            "budget_status": "no_budget",
            "interest_level": "low",
            "handoff_recommended": False,
            "notes": "No immediate timeline or budget. Informational call only."
        }
    ])

    all_turns = [
        {"offset_seconds": 1, "speaker": "bot", "text": f"Hi {lead_name}, this is Sarah from the LeadQualify team. I saw you requested info on {product_interest} and wanted to do a quick 1-minute call to understand your needs. Is now a good time?"},
        {"offset_seconds": 5, "speaker": "user", "text": "Yes, sure. I have a few minutes to chat."},
        {"offset_seconds": 9, "speaker": "bot", "text": "Great! What is the primary problem or pain point you're trying to solve?"},
        {"offset_seconds": 14, "speaker": "user", "text": f"We are trying to solve: {profile['pain_point']}"},
        {"offset_seconds": 19, "speaker": "bot", "text": "Understood. When are you looking to implement a solution?"},
        {"offset_seconds": 23, "speaker": "user", "text": f"Probably {profile['timeline_window'].replace('_', ' ')}."},
        {"offset_seconds": 27, "speaker": "bot", "text": "Excellent. And do you have an approved budget allocated for this?"},
        {"offset_seconds": 31, "speaker": "user", "text": "We are still pricing it out, but we have some funds set aside." if profile['budget_status'] == 'pricing_out' else "Yes, it is fully approved." if profile['budget_status'] == 'approved' else "No, not yet."},
        {"offset_seconds": 35, "speaker": "bot", "text": "Got it. I'll make sure one of our specialists follows up with all the details. Thanks for your time!"},
        {"offset_seconds": 39, "speaker": "user", "text": "Thank you, talk soon."}
    ]

    current_turns = []
    for turn in all_turns:
        time.sleep(1.2)  # Simulate speech turn timing
        current_turns.append(turn)
        db = db_session_factory()
        try:
            lead = db.query(Lead).filter(Lead.id == lead_id).first()
            if not lead or lead.status != "connected":
                break
            lead.transcript = json.dumps(current_turns)
            db.commit()
        except Exception as e:
            logger.error(f"Error updating live transcript turn for lead {lead_id}: {e}")
            db.rollback()
        finally:
            db.close()

    # Phase 3: Finalizing Call
    time.sleep(0.5)
    db = db_session_factory()
    try:
        lead = db.query(Lead).filter(Lead.id == lead_id).first()
        if lead and lead.status == "connected":
            lead.status = "completed"
            lead.pain_point = profile["pain_point"]
            lead.timeline_window = profile["timeline_window"]
            lead.budget_status = profile["budget_status"]
            lead.interest_level = profile["interest_level"]
            lead.handoff_recommended = profile["handoff_recommended"]
            lead.notes = profile["notes"]
            lead.transcript = json.dumps(current_turns)
            db.commit()
            logger.info(f"Mock callback complete. Lead {lead.id} status updated to completed.")
    except Exception as e:
        logger.error(f"Error finalizing mock call: {e}")
        db.rollback()
    finally:
        db.close()


# API Endpoints
@app.post("/api/leads", response_model=LeadOut)
async def create_lead(
    lead_in: LeadCreate, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db)
):
    """
    Creates a new lead and schedules an outbound call.
    """
    # Initialize Lead
    db_lead = Lead(
        name=lead_in.name,
        phone=lead_in.phone,
        company=lead_in.company,
        product_interest=lead_in.product_interest,
        status="pending"
    )
    db.add(db_lead)
    db.commit()
    db.refresh(db_lead)
    
    logger.info(f"Registered new lead: {db_lead.name} ({db_lead.phone})")
    
    if MOCK_MODE:
        # Generate mock call identifier
        mock_id = f"call_mock_{uuid.uuid4().hex[:12]}"
        db_lead.call_id = mock_id
        db_lead.status = "calling"
        db.commit()
        
        # Spawn background simulator and timeout checker
        from database import SessionLocal
        background_tasks.add_task(simulate_mock_call, db_lead.id, SessionLocal)
        background_tasks.add_task(check_call_timeout, db_lead.id, SessionLocal)
        logger.info(f"Dispatched mock call {mock_id} for lead {db_lead.id}")
    else:
        # Live CALL-E implementation
        playbook = get_qualification_playbook(
            name=db_lead.name,
            company=db_lead.company,
            product_interest=db_lead.product_interest
        )
        
        try:
            # Construct dynamic webhook URL
            webhook_url_target = WEBHOOK_URL or f"http://localhost:{os.getenv('PORT', '8000')}/api/webhook"
            
            call_response = calle_client.calls.create(
                task=playbook["task"],
                result_schema=playbook["result_schema"],
                recipient={"phone": CALLE_CALL_RECIPIENT},
                webhook_url=webhook_url_target,
                idempotency_key=f"lead_qualify_{db_lead.id}_{uuid.uuid4().hex[:8]}_call_v1",
                metadata={"lead_id": str(db_lead.id)}
            )
            
            db_lead.call_id = call_response["id"]
            db_lead.status = "calling"
            db.commit()
            db.refresh(db_lead)
            
            # Spawn background status poller and timeout handler
            from database import SessionLocal
            background_tasks.add_task(poll_call_status, db_lead.id, SessionLocal)
            
            logger.info(f"Dispatched live CALL-E call {db_lead.call_id} for lead {db_lead.id}")
            
        except Exception as e:
            logger.error(f"Failed to initiate CALL-E call: {e}")
            db_lead.status = "failed"
            db_lead.notes = f"Failed to initiate call via CALL-E: {str(e)}"
            db.commit()

            
    return db_lead


@app.get("/api/leads", response_model=list[LeadOut])
def list_leads(db: Session = Depends(get_db)):
    """
    Returns all leads, sorted by creation date descending.
    """
    return db.query(Lead).order_by(Lead.created_at.desc()).all()


@app.get("/api/leads/{lead_id}", response_model=LeadOut)
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    """
    Returns details for a single lead.
    """
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@app.delete("/api/leads/{lead_id}")
def delete_lead(lead_id: int, db: Session = Depends(get_db)):
    """
    Deletes a single lead from the database.
    """
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db.delete(lead)
    db.commit()
    return {"ok": True, "message": "Lead deleted successfully"}


@app.delete("/api/leads")
def clear_all_leads(db: Session = Depends(get_db)):
    """
    Clears all leads from the database.
    """
    count = db.query(Lead).delete()
    db.commit()
    return {"ok": True, "message": f"Cleared {count} leads from database", "count": count}


@app.post("/api/leads/{lead_id}/redial", response_model=LeadOut)
async def redial_lead(
    lead_id: int, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db)
):
    """
    Re-initiates an outbound call for an existing lead.
    """
    db_lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not db_lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    db_lead.status = "calling"
    db_lead.notes = None
    db_lead.transcript = None
    db_lead.pain_point = None
    db_lead.timeline_window = None
    db_lead.budget_status = None
    db_lead.interest_level = None
    db_lead.handoff_recommended = False
    db.commit()
    db.refresh(db_lead)
    
    logger.info(f"Redialing lead: {db_lead.name} ({db_lead.phone})")
    
    if MOCK_MODE:
        mock_id = f"call_mock_{uuid.uuid4().hex[:12]}"
        db_lead.call_id = mock_id
        db.commit()
        from database import SessionLocal
        background_tasks.add_task(simulate_mock_call, db_lead.id, SessionLocal)
        background_tasks.add_task(check_call_timeout, db_lead.id, SessionLocal)
    else:
        playbook = get_qualification_playbook(
            name=db_lead.name,
            company=db_lead.company,
            product_interest=db_lead.product_interest
        )
        try:
            webhook_url_target = WEBHOOK_URL or f"http://localhost:{os.getenv('PORT', '8000')}/api/webhook"
            call_response = calle_client.calls.create(
                task=playbook["task"],
                result_schema=playbook["result_schema"],
                recipient={"phone": CALLE_CALL_RECIPIENT},
                webhook_url=webhook_url_target,
                idempotency_key=f"lead_qualify_{db_lead.id}_{uuid.uuid4().hex[:8]}_redial",
                metadata={"lead_id": str(db_lead.id)}
            )
            db_lead.call_id = call_response["id"]
            db.commit()
            db.refresh(db_lead)
            from database import SessionLocal
            background_tasks.add_task(poll_call_status, db_lead.id, SessionLocal)
        except Exception as e:
            logger.error(f"Failed to redial CALL-E call: {e}")
            db_lead.status = "failed"
            db_lead.notes = f"Failed to redial call via CALL-E: {str(e)}"
            db.commit()
            
    return db_lead


@app.get("/api/system/status")
def get_system_status():
    """
    Returns system status, execution mode, and configured features.
    """
    return {
        "mock_mode": MOCK_MODE,
        "webhook_url": WEBHOOK_URL or f"http://localhost:{os.getenv('PORT', '8000')}/api/webhook",
        "agent_name": os.getenv("AGENT_NAME", "Sarah"),
        "company_name": os.getenv("COMPANY_NAME", "LeadQualify"),
        "calle_connected": not MOCK_MODE and calle_client is not None
    }



@app.post("/api/webhook")
async def receive_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Asynchronous receiver for terminal call events from CALL-E.
    """
    raw_body = await request.body()
    
    # 1. Verification Checklist (matching event ID header to prevent spoofing)
    event_id = request.headers.get("CALL-E-Event-Id")
    try:
        event_data = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
        
    if not event_id or event_id != event_data.get("id"):
        logger.warning(f"Webhook rejected: Event-Id header '{event_id}' mismatch with body ID '{event_data.get('id')}'")
        raise HTTPException(status_code=400, detail="Event ID signature verification failed")

    event_type = event_data.get("type")
    call_payload = event_data.get("data", {})
    call_id = call_payload.get("id")
    
    logger.info(f"Received webhook: Event={event_id}, Type={event_type}, Call={call_id}")
    
    # Find matching lead
    lead = db.query(Lead).filter(Lead.call_id == call_id).first()
    if not lead:
        logger.warning(f"Webhook call ID {call_id} does not match any database lead.")
        return {"ok": True, "message": "Ignored: lead not found"}
        
    # Ignore duplicates (Idempotent Webhook Handling)
    if lead.status in ["completed", "failed"]:
        logger.info(f"Webhook ignored: Lead {lead.id} already in terminal state '{lead.status}'")
        return {"ok": True, "message": "Ignored: already processed"}

    # 2. Origin Assurance (Optional but recommended for production verification)
    if not MOCK_MODE and calle_client:
        try:
            logger.info(f"Fetching source verification details for call {call_id}...")
            verified_call = calle_client.calls.get(call_id)
            call_payload = verified_call  # Use the cryptographically secured fetched data
        except Exception as e:
            logger.error(f"Origin assurance failed. Unable to fetch verified call state: {e}")
            raise HTTPException(status_code=403, detail="Origin verification failed")

    # Extract transcripts if present
    turns = []
    recipients = call_payload.get("recipients", [])
    if recipients:
        recipient = recipients[0]
        attempts = recipient.get("attempts", [])
        if attempts:
            turns = attempts[0].get("transcript_turns", [])
            
    if turns:
        lead.transcript = json.dumps(turns)

    was_connected = lead.status == "connected" or len(turns) > 0
    api_status = call_payload.get("status", "completed")
    
    if api_status == "completed" or was_connected:
        lead.status = "completed"
    else:
        lead.status = api_status

    # Extract Structured Outcome Results
    structured_result = call_payload.get("structured_result")
    if structured_result:
        lead.pain_point = structured_result.get("pain_point")
        lead.timeline_window = structured_result.get("timeline_window")
        lead.budget_status = structured_result.get("budget_status")
        lead.interest_level = structured_result.get("interest_level")
        lead.handoff_recommended = bool(structured_result.get("handoff_recommended", False))
        lead.notes = structured_result.get("notes")
    else:
        lead.notes = call_payload.get("failure_message") or ("Call completed successfully." if was_connected else "No structured result extracted.")
        if lead.status == "failed" and not was_connected:
            # Extract failure codes
            failure_code = call_payload.get("failure_code")
            if failure_code in ["no_answer", "no_human_answered"]:
                lead.status = "no_answer"
            elif failure_code == "declined":
                lead.status = "declined"

    db.commit()
    logger.info(f"Lead {lead.id} updated successfully via webhook. Handoff={lead.handoff_recommended}")
    
    return {"ok": True}


# Serve Static Frontend Files
try:
    app.mount("/static", StaticFiles(directory="static"), name="static")
except AssertionError:
    # Directory will be created shortly, fallback mount safety
    pass

@app.get("/")
def read_root():
    """
    Serves the main dashboard page.
    """
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "index.html"))
