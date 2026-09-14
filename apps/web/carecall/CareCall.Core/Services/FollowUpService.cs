using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CareCall.Core.Services;

public class FollowUpService(CallEDbContext db, ILogger<FollowUpService> logger) : IFollowUpService
{
    public async Task<FollowUpPlan> CreatePlanAsync(Guid patientId, CancellationToken ct = default)
    {
        var patient = await db.Patients
            .Include(p => p.FollowUpPlan)
            .FirstOrDefaultAsync(p => p.Id == patientId, ct)
            ?? throw new InvalidOperationException($"Paciente {patientId} no encontrado.");

        var schedule = AlertRules.BuildSchedule(patient.DischargeDate);

        if (patient.FollowUpPlan is null)
        {
            patient.FollowUpPlan = new FollowUpPlan
            {
                PatientId = patient.Id,
                Active = true,
                ScheduledDates = schedule
            };
        }
        else
        {
            patient.FollowUpPlan.ScheduledDates = schedule;
            patient.FollowUpPlan.Active = true;
        }

        patient.Status = PatientStatus.InFollowUp;
        await db.SaveChangesAsync(ct);
        return patient.FollowUpPlan;
    }

    public async Task<IReadOnlyList<Patient>> GetDueCallsAsync(DateTime now, CancellationToken ct = default)
    {
        var candidates = await db.Patients
            .Include(p => p.FollowUpPlan)
            .Include(p => p.CallSessions)
            .Where(p => p.FollowUpPlan != null
                        && p.FollowUpPlan.Active
                        && p.Status != PatientStatus.Completed)
            .AsSplitQuery()
            .ToListAsync(ct);

        return candidates
            .Where(p => AlertRules.DueCallCount(p.FollowUpPlan!.ScheduledDates, now) > p.CallSessions.Count)
            .ToList();
    }

    public async Task<SymptomAssessment> RegisterAssessmentAsync(Guid callSessionId, SymptomAssessmentDto dto, CancellationToken ct = default)
    {
        var session = await db.CallSessions
            .Include(c => c.Assessment)
            .Include(c => c.Patient!).ThenInclude(p => p.CallSessions).ThenInclude(c => c.Assessment)
            .Include(c => c.Patient!).ThenInclude(p => p.FollowUpPlan)
            .AsSplitQuery()
            .FirstOrDefaultAsync(c => c.Id == callSessionId, ct)
            ?? throw new InvalidOperationException($"CallSession {callSessionId} no encontrada.");

        var patient = session.Patient ?? throw new InvalidOperationException("La llamada no tiene paciente asociado.");

        RiskLevel? previousRisk = patient.CallSessions
            .Where(c => c.Id != session.Id && c.Assessment is not null)
            .OrderByDescending(c => c.DateTime)
            .Select(c => (RiskLevel?)c.Assessment!.RiskClassification)
            .FirstOrDefault();

        var assessment = session.Assessment ?? new SymptomAssessment { CallSessionId = session.Id };
        assessment.ExtractedSymptoms = dto.Symptoms;
        assessment.RiskClassification = dto.RiskClassification;
        assessment.Summary = dto.Summary;
        assessment.WorseningDetected = dto.WorseningDetected;
        assessment.CreatedOn = DateTime.UtcNow;

        if (session.Assessment is null)
        {
            session.Assessment = assessment;
            db.SymptomAssessments.Add(assessment);
        }

        session.Outcome = CallOutcome.Completed;
        patient.RiskLevel = dto.RiskClassification;

        var decision = AlertRules.Evaluate(patient, dto, previousRisk);
        if (decision.CreateAlert)
        {
            db.Alerts.Add(new Alert
            {
                PatientId = patient.Id,
                Severity = decision.Severity,
                Description = decision.Description
            });
            patient.Status = decision.NewStatus;
            logger.LogWarning("{Severity} alert created for patient {PatientId}", decision.Severity, patient.Id);
        }

        if (patient.Status != PatientStatus.Escalated
            && patient.FollowUpPlan is not null
            && patient.CallSessions.Count(c => c.Outcome == CallOutcome.Completed) >= patient.FollowUpPlan.ScheduledDates.Count)
        {
            patient.Status = PatientStatus.Completed;
            patient.FollowUpPlan.Active = false;
        }

        await db.SaveChangesAsync(ct);
        return assessment;
    }

    public async Task ResolveAlertAsync(Guid alertId, CancellationToken ct = default)
    {
        var alert = await db.Alerts.FirstOrDefaultAsync(a => a.Id == alertId, ct);
        if (alert is null || alert.Resolved) return;

        alert.Resolved = true;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Records the outcome of an incomplete call and applies the unreachable-patient rule.</summary>
    public async Task RegisterCallOutcomeAsync(Guid callSessionId, CallOutcome outcome, CancellationToken ct = default)
    {
        var session = await db.CallSessions
            .Include(c => c.Patient!).ThenInclude(p => p.CallSessions)
            .FirstOrDefaultAsync(c => c.Id == callSessionId, ct);

        if (session is null) return;

        session.Outcome = outcome;
        var patient = session.Patient;

        if (patient is not null && outcome is CallOutcome.NoAnswer or CallOutcome.Failed)
        {
            var ordered = patient.CallSessions.OrderBy(c => c.DateTime).ToList();
            var decision = AlertRules.EvaluateUnanswered(patient, ordered);
            var alreadyOpen = await db.Alerts.AnyAsync(
                a => a.PatientId == patient.Id && !a.Resolved && a.Description.Contains("no responde"), ct);

            if (decision.CreateAlert && !alreadyOpen)
            {
                db.Alerts.Add(new Alert
                {
                    PatientId = patient.Id,
                    Severity = decision.Severity,
                    Description = decision.Description
                });
            }
        }

        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<Alert>> GetOpenAlertsAsync(CancellationToken ct = default) =>
        await db.Alerts
            .Include(a => a.Patient)
            .Where(a => !a.Resolved)
            .OrderByDescending(a => a.Severity)
            .ThenByDescending(a => a.CreatedOn)
            .ToListAsync(ct);
}
