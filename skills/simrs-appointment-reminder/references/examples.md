# Examples — SIMRS Appointment Reminder

## Example 1: Single Appointment Reminder (CLI)

Staff wants to remind a patient about tomorrow's cardiology appointment.

```bash
# 1. Check CALL-E auth
node packages/cli/bin/calle.js auth status

# 2. Plan the call
node packages/cli/bin/calle.js call plan \
  --to-phone "+6285929931919" \
  --goal "Anda adalah asisten pengingat janji temu RSUD Leuwiliang. Telepon pasien untuk mengingatkan kontrol besok: Dr. Ahmad (Poli Jantung), 29 Juli 2026 jam 09:00. Tanya apakah bisa hadir. Jika ingin reschedule, tanya waktu baru. Jika batalkan, catat alasan. Berbicara dalam Bahasa Indonesia. Jangan berikan saran medis." \
  --language Indonesian \
  --timezone Asia/Jakarta

# 3. Run the call (use plan_id and confirm_token from step 2)
node packages/cli/bin/calle.js call run \
  --plan-id "plan_abc123" \
  --confirm-token "token_xyz789"

# 4. Check result
node packages/cli/bin/calle.js call status --run-id "run_def456"
```

## Example 2: Batch Reminder via Python Script

Process next-day appointments from a SIMRS API:

```python
import json
import subprocess

appointments = [
    {
        "appointmentId": "APT-20260728-001",
        "patientName": "Budi Santoso",
        "phoneNumber": "+6285929931919",
        "doctorName": "Dr. Ahmad Ridwan",
        "department": "Poli Jantung",
        "appointmentDate": "2026-07-29",
        "appointmentTime": "09:00",
        "timezone": "Asia/Jakarta"
    },
    {
        "appointmentId": "APT-20260728-002",
        "patientName": "Siti Rahayu",
        "phoneNumber": "+6281234567890",
        "doctorName": "Dr. Dewi Lestari",
        "department": "Poli Anak",
        "appointmentDate": "2026-07-29",
        "appointmentTime": "10:30",
        "timezone": "Asia/Jakarta"
    }
]

results = []

for apt in appointments:
    goal = (
        f"Anda adalah asisten pengingat janji temu RSUD Leuwiliang. "
        f"Telepon pasien {apt['patientName']} untuk mengingatkan kontrol: "
        f"{apt['doctorName']} ({apt['department']}), "
        f"{apt['appointmentDate']} jam {apt['appointmentTime']}. "
        f"Tanya apakah bisa hadir. Jika ingin reschedule, tanya waktu baru. "
        f"Jika batalkan, catat alasan. Berbicara dalam Bahasa Indonesia. "
        f"Jangan berikan saran medis."
    )

    cmd = [
        "node", "packages/cli/bin/calle.js", "call", "start",
        "--to-phone", apt["phoneNumber"],
        "--goal", goal,
        "--language", "Indonesian",
        "--timezone", apt["timezone"]
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    call_result = json.loads(result.stdout) if result.stdout else {"error": result.stderr}

    results.append({
        "appointmentId": apt["appointmentId"],
        "phone": apt["phoneNumber"][:7] + "****" + apt["phoneNumber"][-4:],
        "status": call_result.get("status", "ERROR"),
        "runId": call_result.get("run_id")
    })

# Print batch summary
for r in results:
    print(f"{r['appointmentId']}: {r['status']} ({r['phone']})")
```

## Example 3: MCP Tool Call (Agent Integration)

When CALL-E is configured as an MCP server in an AI agent:

```json
{
  "tool": "plan_call",
  "arguments": {
    "user_input": "Call patient at +6285929931919 to remind them about their cardiology appointment tomorrow at 9 AM with Dr. Ahmad. Ask if they can attend. Speak Indonesian.",
    "timezone": "Asia/Jakarta"
  }
}
```

## Example 4: SatuSehat FHIR Writeback

After a successful confirmation call, create a FHIR Encounter:

```json
{
  "resourceType": "Encounter",
  "status": "arrived",
  "class": {
    "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
    "code": "AMB",
    "display": "ambulatory"
  },
  "appointment": [{
    "reference": "Appointment/APT-20260728-001"
  }],
  "participant": [{
    "individual": {
      "reference": "Practitioner/pract-ahmad-ridwan"
    }
  }],
  "period": {
    "start": "2026-07-29T09:00:00+07:00"
  }
}
```

## Example 5: Rescheduling Flow

When patient wants to reschedule during the call:

```
AI: "Baik, Bapak ingin mengubah jadwal. Kapan waktu yang lebih cocok?"
Patient: "Bisa diganti hari Jumat jam 2 siang tidak?"
AI: "Baik, saya akan mencatat perubahan jadwal ke Jumat 1 Agustus jam 14:00. Terima kasih."
```

Output:
```json
{
  "appointmentId": "APT-20260728-001",
  "outcome": "RESCHEDULED",
  "newDate": "2026-08-01",
  "newTime": "14:00",
  "originalDate": "2026-07-29",
  "originalTime": "09:00"
}
```
