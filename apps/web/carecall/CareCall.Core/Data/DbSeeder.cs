using CareCall.Core.Domain;
using Microsoft.EntityFrameworkCore;
using System;

namespace CareCall.Core.Data;

public static class DbSeeder
{
    // Fictitious demo phone numbers (reserved 555 range): never contact real phones.
    private const string DemoPhonePrimary = "+15555010100";
    private const string DemoPhoneSecondary = "+15555010101";

    // Fictitious phone for the rest of the filler patients (give volume to the dashboard).
    private const string DemoPhoneOthers = "+15555010102";

    /// <summary>
    /// Fixes the phone number of the demo patients already seeded in existing
    /// databases, so we don't have to drop the DB when the real number changes.
    /// </summary>
    private static async Task UpdateDemoPhonesAsync(CallEDbContext db, CancellationToken ct)
    {
        var demoPatients = await db.Patients
            .Where(p => p.Name == "Manuel Ortega Ruiz" || p.Name == "Carmen Delgado Sanz"
                     || p.Name == "Jose Luis Marin" || p.Name == "Ana Belen Ferrer" || p.Name == "Rosa Iglesias Pena")
            .ToListAsync(ct);

        var changed = false;
        foreach (var patient in demoPatients)
        {
            var expectedPhone = patient.Name switch
            {
                "Manuel Ortega Ruiz" => DemoPhonePrimary,
                "Carmen Delgado Sanz" => DemoPhoneSecondary,
                _ => DemoPhoneOthers
            };
            if (patient.PhoneNumber != expectedPhone)
            {
                patient.PhoneNumber = expectedPhone;
                changed = true;
            }
        }

        if (changed)
        {
            await db.SaveChangesAsync(ct);
        }
    }

    public static async Task SeedAsync(CallEDbContext db, CancellationToken ct = default)
    {
        await db.Database.MigrateAsync(ct);
        if (await db.Patients.AnyAsync(ct))
        {
            await UpdateDemoPhonesAsync(db, ct);
            return;
        }

        var now = DateTime.UtcNow;

        // Patient 1: the only one with an overdue call. On startup, the scheduler
        // will call them immediately. This is the case shown in the demo.
        var manuel = NewPatient("Manuel Ortega Ruiz", DemoPhonePrimary, 1948,
            now.AddDays(-1), "Community-acquired pneumonia", RiskLevel.High);
        Plan(manuel, now.AddMinutes(-2), now.AddDays(2), now.AddDays(6));

        // Patient 2: real phone number, but scheduled in the future. Triggered
        // manually from the dashboard whenever it's useful during the demo.
        var carmen = NewPatient("Carmen Delgado Sanz", DemoPhoneSecondary, 1952,
            now.AddDays(-2), "Decompensated heart failure", RiskLevel.High);
        Plan(carmen, now.AddHours(4), now.AddDays(3), now.AddDays(7));

        // Rest: fictitious phone numbers and future dates. They give volume to the dashboard
        // without ever consuming quota.
        var jose = NewPatient("Jose Luis Marin", DemoPhoneOthers, 1961,
            now.AddDays(-3), "COPD exacerbation", RiskLevel.Medium);
        Plan(jose, now.AddDays(1), now.AddDays(4), now.AddDays(8));

        var ana = NewPatient("Ana Belen Ferrer", DemoPhoneOthers, 1979,
            now.AddDays(-1), "Distal radius fracture", RiskLevel.Low);
        Plan(ana, now.AddDays(2), now.AddDays(5), now.AddDays(9));

        var rosa = NewPatient("Rosa Iglesias Pena", DemoPhoneOthers, 1944,
            now.AddDays(-4), "Complicated urinary tract infection", RiskLevel.Medium);
        Plan(rosa, now.AddDays(1), now.AddDays(3), now.AddDays(10));

        var patients = new List<Patient> { manuel, carmen, jose, ana, rosa };

        db.Patients.AddRange(patients);
        await db.SaveChangesAsync(ct);

        await SeedCallsAndAlertsAsync(db, patients, ct);
    }

    /// <summary>Demo data: completed calls, AI assessments and alerts.</summary>
    private static async Task SeedCallsAndAlertsAsync(CallEDbContext db, List<Patient> patients, CancellationToken ct)
    {
        var manuel = patients[0];   // Pneumonia - high risk, worsening
        var carmen = patients[1];   // Heart failure - stable / medium
        var jose = patients[2];     // COPD - improving
        var ana = patients[3];      // Fracture - uneventful
        var rosa = patients[4];     // UTI - missed first call
        var now = DateTime.UtcNow;

        var calls = new List<CallSession>
        {
            Call(manuel, now.AddHours(-30), 3.4,
                "CALL-E: Good morning Manuel, I'm calling from the hospital follow-up service. How is your cough?\nPatient: A bit better, but I still get a fever in the afternoons, 37.8.\nCALL-E: Do you feel short of breath when you move around?\nPatient: Only when I climb stairs.\nCALL-E: Are you taking the antibiotic as prescribed?\nPatient: Yes, every eight hours, without missing a dose.\nCALL-E: Great. I will call you again in two days.",
                ["evening fever 37.8", "productive cough", "mild exertional dyspnea"],
                RiskLevel.Medium, false,
                "Patient with pneumonia on antibiotic therapy. Persistent low-grade evening fever and productive cough. Dyspnea only on exertion. Good adherence."),

            Call(manuel, now.AddHours(-3), 4.1,
                "CALL-E: Good morning Manuel, how are you feeling today?\nPatient: Worse. Last night I was gasping for air even while sitting and my fever rose to 38.9.\nCALL-E: Have you noticed chest pain when breathing?\nPatient: Yes, on the right side, especially with deep breaths.\nCALL-E: Have you been able to eat anything?\nPatient: Almost nothing, I have had no appetite for two days.\nCALL-E: I will notify the medical team so they can assess you today.",
                ["fever 38.9", "dyspnea at rest", "right pleuritic chest pain", "loss of appetite"],
                RiskLevel.High, true,
                "Clear worsening: high fever, dyspnea at rest and pleuritic pain. Suspected respiratory complication. Requires urgent in-person assessment."),

            Call(carmen, now.AddHours(-26), 2.8,
                "CALL-E: Good morning Carmen. Did you weigh yourself this morning?\nPatient: Yes, 200 grams more than yesterday.\nCALL-E: How is the swelling in your legs?\nPatient: The same as when I left the hospital.\nCALL-E: How many pillows do you sleep with?\nPatient: Two, as always.\nCALL-E: Very good, keep taking the diuretic and weighing yourself daily.",
                ["weight gain 0.2 kg", "stable ankle edema", "two-pillow orthopnea"],
                RiskLevel.Medium, false,
                "Stable heart failure. Minimal weight gain and unchanged edema. Continue diuretic and daily weight monitoring."),

            Call(jose, now.AddDays(-2), 2.2,
                "CALL-E: Hello Jose Luis, how is your breathing?\nPatient: Much better than in the emergency room, I barely use the rescue inhaler.\nCALL-E: What is the sputum like?\nPatient: White and very little.\nCALL-E: Have you started smoking again?\nPatient: No, not a single cigarette.\nCALL-E: Excellent, keep it up.",
                ["improved dyspnea", "scant white sputum", "minimal rescue inhaler use"],
                RiskLevel.Low, false,
                "COPD clearly improving after the exacerbation. No warning signs. Continue the prescribed treatment."),

            Call(jose, now.AddHours(-5), 1.9,
                "CALL-E: Hello again Jose Luis, are you still doing well?\nPatient: Yes, I already go for a walk every morning.\nCALL-E: Have you had any fever?\nPatient: None at all.\nCALL-E: Perfect, the recovery looks on track.",
                ["no dyspnea at rest", "exercise tolerance recovered"],
                RiskLevel.Low, false,
                "Sustained favourable course. Patient asymptomatic and back to usual activity."),

            Call(ana, now.AddHours(-20), 1.6,
                "CALL-E: Good afternoon Ana Belen, how is the cast?\nPatient: Fine, it bothers me a little at night.\nCALL-E: Do your fingers feel numb or look bluish?\nPatient: No, they look normal.\nCALL-E: Are you taking the painkiller?\nPatient: Only when it hurts.\nCALL-E: That is right, call us if your fingers change colour.",
                ["mild night pain", "no signs of vascular compromise"],
                RiskLevel.Low, false,
                "Uneventful recovery after fracture. Pain controlled and distal perfusion preserved."),

            NoAnswerCall(rosa, now.AddDays(-2)),

            Call(rosa, now.AddHours(-2), 3.0,
                "Patient: Sorry I did not pick up the phone the other day.\nCALL-E: No problem Rosa. How is the burning when you urinate?\nPatient: The same, and now my lower back hurts.\nCALL-E: Have you had any fever?\nPatient: 38 this morning.\nCALL-E: Have you finished the antibiotic?\nPatient: I have two days left.\nCALL-E: I will raise an alert so you are reviewed within 24 hours.",
                ["persistent dysuria", "lower back pain", "fever 38"],
                RiskLevel.High, true,
                "Urinary tract infection with persistent dysuria, lower back pain and fever despite antibiotics. Possible progression to pyelonephritis. Reassess within 24 h.")
        };

        db.CallSessions.AddRange(calls);

        db.Alerts.AddRange(
            new Alert
            {
                PatientId = manuel.Id,
                Severity = AlertSeverity.Critical,
                Description = "Respiratory worsening: dyspnea at rest, fever 38.9 and pleuritic pain. Contact immediately.",
                CreatedOn = now.AddHours(-2.9)
            },
            new Alert
            {
                PatientId = rosa.Id,
                Severity = AlertSeverity.Critical,
                Description = "Suspected pyelonephritis: fever and lower back pain despite antibiotic therapy.",
                CreatedOn = now.AddHours(-1.9)
            },
            new Alert
            {
                PatientId = rosa.Id,
                Severity = AlertSeverity.Warning,
                Description = "Follow-up call unanswered on the first attempt.",
                CreatedOn = now.AddDays(-2).AddMinutes(1)
            },
            new Alert
            {
                PatientId = carmen.Id,
                Severity = AlertSeverity.Info,
                Description = "Slight weight gain. Monitor daily weight control.",
                CreatedOn = now.AddHours(-25.9),
                Resolved = true
            });

        manuel.Status = PatientStatus.Escalated;
        manuel.RiskLevel = RiskLevel.High;
        rosa.Status = PatientStatus.Escalated;
        rosa.RiskLevel = RiskLevel.High;
        jose.RiskLevel = RiskLevel.Low;
        ana.Status = PatientStatus.Completed;

        await db.SaveChangesAsync(ct);
    }

    private static CallSession Call(
        Patient patient, DateTime when, double minutes, string transcript,
        List<string> symptoms, RiskLevel risk, bool worsening, string summary) => new()
        {
            PatientId = patient.Id,
            DateTime = when,
            Duration = TimeSpan.FromMinutes(minutes),
            Outcome = CallOutcome.Completed,
            Transcript = transcript,
            ExternalCallId = $"demo-{Guid.NewGuid():N}"[..16],
            Assessment = new SymptomAssessment
            {
                ExtractedSymptoms = symptoms,
                RiskClassification = risk,
                WorseningDetected = worsening,
                Summary = summary,
                CreatedOn = when.AddMinutes(minutes)
            }
        };

    private static CallSession NoAnswerCall(Patient patient, DateTime when) => new()
    {
        PatientId = patient.Id,
        DateTime = when,
        Duration = TimeSpan.FromSeconds(35),
        Outcome = CallOutcome.NoAnswer,
        Transcript = string.Empty,
        ExternalCallId = $"demo-{Guid.NewGuid():N}"[..16]
    };

private static void Plan(Patient p, params DateTime[] dates)
{
    p.Status = PatientStatus.InFollowUp;
    p.FollowUpPlan = new FollowUpPlan
    {
        PatientId = p.Id,
        Active = true,
        ScheduledDates = [.. dates]
    };
}
private static Patient NewPatient(string name, string phone, int birthYear, DateTime discharge, string diagnosis, RiskLevel risk) => new()
    {
        Name = name,
        PhoneNumber = phone,
        BirthDate = new DateOnly(birthYear, 5, 12),
        DischargeDate = discharge,
        Diagnosis = diagnosis,
        RiskLevel = risk
    };
}
