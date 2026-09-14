# Testing Guide

## Dry-Run Testing (No Credentials Needed)

The application defaults to dry-run mode, returning realistic simulated call data.

### Run Unit Tests

```bash
python -m pytest tests/ -v
```

### Run Dry-Run Demo

```bash
python skill/smartrent-maintenance/scripts/dry_run.py
```

This prints a complete walkthrough of all 3 calls with transcripts, evidence, and structured results.

### Test via Dashboard

1. Start the server: `python -m app.main`
2. Open http://localhost:8000
3. Click **"+ New Request"**
4. Fill in any test data and click **"Create & Start Calls"**
5. Watch the workflow progress in real-time (updates every 2 seconds)

### Test via API

```bash
# Create a request
curl -s -X POST http://localhost:8000/api/requests \
  -H "Content-Type: application/json" \
  -d '{"tenant_name":"Test User","tenant_phone":"+15551234567","unit_number":"1A","initial_description":"AC not cooling"}' | python3 -m json.tool

# List requests
curl -s http://localhost:8000/api/requests | python3 -m json.tool

# Get specific request (replace MR-XXXXXX with actual ID)
curl -s http://localhost:8000/api/requests/MR-XXXXXX | python3 -m json.tool

# Get dashboard data
curl -s http://localhost:8000/api/dashboard | python3 -m json.tool
```

## Live Testing (Requires CALL-E Account)

### Setup

1. Get your API key from https://dashboard.heycall-e.com/account/api-keys
2. Edit `.env`:
   ```
   CALLE_API_KEY=your_actual_key
   DRY_RUN=false
   ```
3. Start the server: `python -m app.main`

### Place Real Calls

Create a request with a real phone number in E.164 format:

```bash
curl -X POST http://localhost:8000/api/requests \
  -H "Content-Type: application/json" \
  -d '{"tenant_name":"Your Name","tenant_phone":"+1XXXXXXXXXX","unit_number":"4B","initial_description":"Kitchen sink leaking"}'
```

The AI will call the provided phone number to gather maintenance details.

> **Note:** Vendor calls go to the demo roster numbers by default.
> Edit `app/workflows.py` `DEFAULT_VENDORS` to use real vendor phone numbers.
