"""FastAPI Hospital EHR Webhook Server & Clinical Dashboard for CareRing Health."""

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse

from src.calle_bridge import CalleBridge
from src.models import (
    DischargedPatientCase,
    PatientDetails,
    PrescribedMedication,
    TriageStatus,
)
from src.triage_engine import CareRingTriageEngine

app = FastAPI(
    title="CareRing Health",
    description="Clinical Post-Discharge Triage & Patient Medication Adherence Voice Concierge powered by CALL-E",
    version="1.0.0"
)

bridge = CalleBridge()
engine = CareRingTriageEngine(bridge=bridge)


def seed_demo_patients():
    p1 = DischargedPatientCase(
        patient=PatientDetails(
            patient_id="PAT-4081",
            name="Rajesh Gupta",
            phone="+919876543210",
            age=58,
            procedure_name="Post-Percutaneous Coronary Intervention (Stent)",
            primary_doctor="Dr. Aditi Joshi, MD (Cardiology)",
            clinic_name="Apollo Heart & Vascular Institute"
        ),
        medications=[
            PrescribedMedication(drug_name="Clopidogrel", dosage="75mg"),
            PrescribedMedication(drug_name="Atorvastatin", dosage="40mg")
        ],
        followup_appointment="Friday at 10:30 AM"
    )
    p2 = DischargedPatientCase(
        patient=PatientDetails(
            patient_id="PAT-4082",
            name="Meera Sengupta",
            phone="+919123456789",
            age=64,
            procedure_name="Total Knee Arthroplasty (Joint Replacement)",
            primary_doctor="Dr. Sameer Kulkarni, MS (Orthopedics)",
            clinic_name="Max Center for Joint Reconstruction"
        ),
        medications=[
            PrescribedMedication(drug_name="Enoxaparin", dosage="40mg Injection"),
            PrescribedMedication(drug_name="Tramadol", dosage="50mg PRN")
        ],
        followup_appointment="Monday at 11:00 AM"
    )
    p3 = DischargedPatientCase(
        patient=PatientDetails(
            patient_id="PAT-4083",
            name="Sunita Nambiar",
            phone="+919811122334",
            age=42,
            procedure_name="Laparoscopic Cholecystectomy",
            primary_doctor="Dr. Priya Bansal, MS (Surgery)",
            clinic_name="Fortis Surgical Sciences"
        ),
        medications=[
            PrescribedMedication(drug_name="Amoxicillin-Clavulanate", dosage="625mg"),
            PrescribedMedication(drug_name="Paracetamol", dosage="650mg")
        ],
        followup_appointment="Wednesday at 02:00 PM"
    )
    engine.register_patient_case(p1)
    engine.register_patient_case(p2)
    engine.register_patient_case(p3)

seed_demo_patients()


@app.get("/api/v1/metrics")
async def get_metrics():
    return engine.get_metrics()


@app.get("/api/v1/patients")
async def list_patients():
    data = []
    for pid, c in engine.cases.items():
        status = engine.triage_states.get(pid, TriageStatus.NORMAL)
        res = engine.clinical_results.get(pid)
        data.append({
            "patient_id": pid,
            "name": c.patient.name,
            "phone": c.patient.phone,
            "age": c.patient.age,
            "procedure": c.patient.procedure_name,
            "doctor": c.patient.primary_doctor,
            "triage_level": status.value,
            "pain_score": res.pain_score if res else None,
            "med_status": res.medication_status.value if res else None,
            "symptoms": res.symptoms_reported if res else None,
            "task_id": res.task_id if res else None,
            "escalated": res.escalate_to_nurse if res else False
        })
    return data


@app.post("/api/v1/patients/{patient_id}/triage")
async def run_triage(patient_id: str, scenario: str = Query("normal")):
    if patient_id not in engine.cases:
        raise HTTPException(status_code=404, detail="Patient record not found")
    res = await engine.run_followup_call(patient_id, scenario=scenario)
    return {
        "success": True,
        "patient_id": patient_id,
        "triage_level": engine.triage_states[patient_id].value,
        "result": res.model_dump()
    }


@app.get("/", response_class=HTMLResponse)
async def dashboard_html():
    return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CareRing Health — Clinical Post-Discharge Voice Concierge</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <!-- Header -->
    <header class="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold text-lg">🩺</div>
                <div>
                    <h1 class="font-extrabold text-xl tracking-tight text-white flex items-center gap-2">
                        CareRing Health
                        <span class="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">CALL-E CLINICAL VOIP</span>
                    </h1>
                    <p class="text-xs text-slate-400">Clinical Post-Discharge Triage & Patient Medication Adherence Voice Concierge</p>
                </div>
            </div>
            <div class="flex items-center gap-4">
                <div class="text-right">
                    <span class="text-xs text-slate-400">Settled Carrier Tasks</span>
                    <p class="text-sm font-bold font-mono text-cyan-400">76 Credits Settled</p>
                </div>
                <button onclick="fetchPatients()" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition">🔄 Refresh</button>
            </div>
        </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <!-- KPI Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Patients Monitored</span>
                <p id="total-patients" class="text-2xl font-black text-cyan-400 font-mono mt-1">3 Cases</p>
                <span class="text-xs text-slate-500 mt-2 block">Post-operative & cardiac recovery</span>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Medication Adherence</span>
                <p id="adherence-rate" class="text-2xl font-black text-emerald-400 font-mono mt-1">100.0%</p>
                <span class="text-xs text-slate-500 mt-2 block">DTMF [1] Verified intake</span>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Critical Escalations Caught</span>
                <p id="critical-caught" class="text-2xl font-black text-rose-400 font-mono mt-1">0 Cases</p>
                <span class="text-xs text-slate-500 mt-2 block">Readmissions prevented early</span>
            </div>
            <div class="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Audit Hash Chain</span>
                <p id="audit-hash" class="text-xs font-mono text-slate-400 mt-2 truncate bg-slate-950 p-2 rounded border border-slate-800">00000000000000000000000000000000</p>
                <span class="text-xs text-emerald-400 mt-1 block">SHA-256 HIPAA Compliant</span>
            </div>
        </div>

        <!-- Patients Table -->
        <div class="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 shadow-xl">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h2 class="text-lg font-bold text-white">Discharged Patient Registry (Hospital EHR Sync)</h2>
                    <p class="text-xs text-slate-400">Automated PSTN follow-ups evaluate post-surgical symptoms, check medications, and alert on-call nurses.</p>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left text-sm text-slate-300">
                    <thead class="bg-slate-800/60 text-xs uppercase font-mono text-slate-400 border-b border-slate-700">
                        <tr>
                            <th class="py-3 px-4">MRN / ID</th>
                            <th class="py-3 px-4">Patient & Age</th>
                            <th class="py-3 px-4">Procedure & Doctor</th>
                            <th class="py-3 px-4">Triage Status</th>
                            <th class="py-3 px-4">Pain Score</th>
                            <th class="py-3 px-4">Clinical Notes / Symptoms</th>
                            <th class="py-3 px-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="patients-tbody" class="divide-y divide-slate-800">
                        <!-- Filled dynamically -->
                    </tbody>
                </table>
            </div>
        </div>
    </main>

    <script>
        async function fetchPatients() {
            try {
                const res = await fetch('/api/v1/patients');
                const patients = await res.json();
                const mRes = await fetch('/api/v1/metrics');
                const metrics = await mRes.json();

                document.getElementById('total-patients').innerText = metrics.total_patients_monitored + ' Cases';
                document.getElementById('adherence-rate').innerText = metrics.adherence_rate_pct + '%';
                document.getElementById('critical-caught').innerText = metrics.emergency_escalations_caught + ' Cases';
                document.getElementById('audit-hash').innerText = metrics.latest_sha256_audit_seal;

                const tbody = document.getElementById('patients-tbody');
                tbody.innerHTML = '';

                patients.forEach(p => {
                    let badge = '';
                    if (p.triage_level === 'CRITICAL_EMERGENCY_ESCALATION') {
                        badge = '<span class="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">🚨 NURSE ALERT</span>';
                    } else if (p.triage_level === 'MODERATE_FOLLOWUP') {
                        badge = '<span class="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">⚠️ ATTENTION</span>';
                    } else if (p.pain_score !== null) {
                        badge = '<span class="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">✅ NORMAL</span>';
                    } else {
                        badge = '<span class="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-slate-700 text-slate-300">PENDING CALL</span>';
                    }

                    const painBadge = p.pain_score !== null 
                        ? `<span class="font-mono font-bold ${p.pain_score >= 4 ? 'text-rose-400' : 'text-emerald-400'}">${p.pain_score} / 5</span>` 
                        : '<span class="text-slate-500">—</span>';

                    const notes = p.symptoms 
                        ? `<span class="text-xs text-cyan-300 italic">"${p.symptoms}"</span>` 
                        : '<span class="text-xs text-slate-500">—</span>';

                    const row = `
                        <tr class="hover:bg-slate-800/30 transition">
                            <td class="py-4 px-4 font-mono font-bold text-white">${p.patient_id}</td>
                            <td class="py-4 px-4">
                                <div class="font-bold text-slate-100">${p.name} (${p.age}y)</div>
                                <div class="text-xs text-slate-400 font-mono">${p.phone}</div>
                            </td>
                            <td class="py-4 px-4">
                                <div class="text-xs text-slate-200">${p.procedure}</div>
                                <div class="text-xs text-slate-400">${p.doctor}</div>
                            </td>
                            <td class="py-4 px-4">${badge}</td>
                            <td class="py-4 px-4">${painBadge}</td>
                            <td class="py-4 px-4 max-w-xs truncate">${notes}</td>
                            <td class="py-4 px-4 text-right space-x-2">
                                <button onclick="triggerCall('${p.patient_id}', 'normal')" class="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition">📞 Normal Triage</button>
                                <button onclick="triggerCall('${p.patient_id}', 'critical')" class="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition">🚨 Severe Flare</button>
                            </td>
                        </tr>
                    `;
                    tbody.innerHTML += row;
                });
            } catch (err) {
                console.error(err);
            }
        }

        async function triggerCall(patientId, scenario) {
            const btn = event.target;
            btn.innerText = 'Calling...';
            btn.disabled = true;
            try {
                await fetch(`/api/v1/patients/${patientId}/triage?scenario=${scenario}`, { method: 'POST' });
                await fetchPatients();
            } finally {
                btn.disabled = false;
            }
        }

        fetchPatients();
    </script>
</body>
</html>
    """
