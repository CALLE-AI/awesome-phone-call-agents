# Runtime Prompt — SIMRS Appointment Reminder

## Call Goal Template

The `goal` parameter for each CALL-E call must include all appointment context while following safety boundaries.

### Standard Template

```
Anda adalah asisten pengingat janji temu otomatis dari [HOSPITAL_NAME].

Telepon pasien berikut untuk mengingatkan jadwal kontrol:
- Nama: [PATIENT_NAME]
- Dokter: [DOCTOR_NAME]
- Poli: [DEPARTMENT]
- Tanggal: [APPOINTMENT_DATE]
- Jam: [APPOINTMENT_TIME]

Tugas Anda:
1. Sapa pasien dengan nama dan sapaan yang sopan
2. Sampaikan informasi janji temu dengan jelas
3. Tanyakan: "Apakah Bapak/Ibu bisa hadir sesuai jadwal?"
4. Jika ingin reschedule: "Kapan waktu yang lebih cocok untuk Bapak/Ibu?"
5. Jika membatalkan: "Boleh saya tahu alasan pembatalannya?"
6. Akhiri dengan terima kasih dan konfirmasi

ATURAN PENTING:
- Berbicara HANYA dalam Bahasa Indonesia
- JANGAN memberikan saran medis, diagnosis, atau rekomendasi pengobatan
- JANGAN menanyakan informasi kesehatan sensitif
- Jika pasien bertanya hal medis, arahkan ke dokter langsung
- Jika pasien menggambarkan kondisi darurat, sarankan hubungi 112/IGD
- Catat jawaban pasien secara akurat
```

### Minimal Template (for MCP)

```
Call patient to remind about appointment:
- Name: [PATIENT_NAME]
- Doctor: [DOCTOR_NAME] ([DEPARTMENT])
- Date: [APPOINTMENT_DATE] at [APPOINTMENT_TIME]
Ask if they can attend. If reschedule, ask preferred time. If cancel, note reason.
Speak Indonesian. No medical advice.
```

## Structured Result Parsing

After the call, parse the structured result to determine outcome:

| Signal in Result | Outcome |
|---|---|
| "confirmed", "bisa hadir", "akan datang" | CONFIRMED |
| "reschedule", "diganti", "ubah jadwal" | RESCHEDULED |
| "cancel", "batal", "tidak bisa" | CANCELLED |
| "tidak diangkat", "no answer", timeout | PENDING_RETRY |
| "nomor salah", "invalid number" | CONTACT_ERROR |

## Batch Runtime Prompt

For batch processing, the orchestrator should:

1. Read appointment list from source (API/file)
2. For each appointment:
   a. Check auth status
   b. Generate call goal from template
   c. Plan call
   d. Run call
   e. Parse result
   f. Write back outcome
3. Generate summary report

```python
# Pseudocode for batch orchestration
for appointment in appointments:
    goal = render_template(TEMPLATE, appointment)
    plan = calle_call_plan(appointment.phone, goal)
    if plan.ready:
        result = calle_call_run(plan.plan_id, plan.confirm_token)
        outcome = parse_outcome(result)
        update_simrs(appointment.id, outcome)
    else:
        outcome = "PLAN_FAILED"
    report.append({"id": appointment.id, "outcome": outcome})
```
