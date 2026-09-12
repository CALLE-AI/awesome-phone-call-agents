using CareCall.Core.Abstractions;
using CareCall.Core.Agents;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CareCall.Core.Services;

/// <summary>Data for a finished call, already normalized.</summary>
public record CallCompletedPayload(
    string? ExternalCallId,
    Guid? CallSessionId,
    string Transcript,
    int? DurationSeconds,
    string? Status,
    string? ProviderSummary = null,
    IReadOnlyList<string>? Evidence = null);

/// <summary>
/// Closes the loop: transcript -> AI analysis -> assessment -> alerts.
/// </summary>
public class CallIngestionService(
    CallEDbContext db,
    IClinicalAiService ai,
    IFollowUpService followUp,
    ILogger<CallIngestionService> logger,
    ClinicalAgentPipeline? pipeline = null)
{
    public async Task<SymptomAssessment?> IngestAsync(CallCompletedPayload payload, CancellationToken ct = default)
    {
        var session = await ResolveSessionAsync(payload, ct);
        if (session is null)
        {
            logger.LogWarning("Call received without an associated session: {ExternalId}", payload.ExternalCallId);
            return null;
        }

        session.Transcript = payload.Transcript ?? string.Empty;
        session.Duration = TimeSpan.FromSeconds(payload.DurationSeconds ?? 0);
        session.Outcome = MapOutcome(payload.Status, session.Transcript);

        await db.SaveChangesAsync(ct);

        if (session.Outcome != CallOutcome.Completed)
        {
            logger.LogInformation("Call {Id} has no useful conversation ({Outcome}); skipping analysis.", session.Id, session.Outcome);
            return null;
        }

        var patient = session.Patient
            ?? await db.Patients.FirstAsync(p => p.Id == session.PatientId, ct);

        var previousSummary = await db.SymptomAssessments
            .Where(a => a.CallSession!.PatientId == patient.Id && a.CallSessionId != session.Id)
            .OrderByDescending(a => a.CreatedOn)
            .Select(a => a.Summary)
            .FirstOrDefaultAsync(ct);

        // CALL-E provides its own summary and evidence: we add them to the context,
        // but the risk classification is always decided by our model.
        var transcript = BuildAnalysisInput(session.Transcript, payload);

        SymptomAssessmentDto dto;
        SchedulingProposalDto? scheduling = null;

        if (pipeline is not null)
        {
            // Full agentic pipeline: trend, analysis, safety review,
            // SBAR note and rescheduling proposal.
            var result = await pipeline.RunAsync(session, patient, transcript, ct);
            dto = result.Assessment;
            scheduling = result.Scheduling;
        }
        else
        {
            // Without AI configured we still ingest the call: a basic assessment
            // is better than losing the record.
            dto = await ai.AnalyzeTranscriptAsync(transcript, patient, previousSummary, ct);
        }

        if (scheduling is not null)
            await ApplySchedulingAsync(patient.Id, scheduling, ct);

        // Persist the assessment after applying the next-call proposal so a
        // one-call trial plan is not closed before its next date is added.
        var assessment = await followUp.RegisterAssessmentAsync(session.Id, dto, ct);

        return assessment;
    }

    /// <summary>
    /// Transfers the scheduler's proposal to the follow-up plan. It only adds the
    /// next date: it does not rewrite the whole plan so as not to erase human decisions.
    /// </summary>
    private async Task ApplySchedulingAsync(Guid patientId, SchedulingProposalDto proposal, CancellationToken ct)
    {
        var plan = await db.FollowUpPlans.FirstOrDefaultAsync(p => p.PatientId == patientId && p.Active, ct);
        if (plan is null) return;

        if (proposal.DischargeFollowUp)
        {
            plan.Active = false;
            logger.LogInformation("Follow-up closed for patient {PatientId} by the scheduler.", patientId);
        }
        else
        {
            var next = DateTime.UtcNow.AddDays(proposal.NextCallInDays).Date.AddHours(10);
            if (!plan.ScheduledDates.Any(d => d > DateTime.UtcNow && d.Date == next.Date))
                plan.ScheduledDates.Add(next);
        }

        await db.SaveChangesAsync(ct);
    }

    private static string BuildAnalysisInput(string transcript, CallCompletedPayload payload)
    {
        var sb = new System.Text.StringBuilder(transcript);

        if (!string.IsNullOrWhiteSpace(payload.ProviderSummary))
            sb.AppendLine().AppendLine().Append("Resumen del agente de la llamada: ").Append(payload.ProviderSummary);

        if (payload.Evidence is { Count: > 0 })
        {
            sb.AppendLine().AppendLine().AppendLine("Observaciones del agente de la llamada:");
            foreach (var item in payload.Evidence) sb.Append("- ").AppendLine(item);
        }

        return sb.ToString();
    }

    private async Task<CallSession?> ResolveSessionAsync(CallCompletedPayload payload, CancellationToken ct)
    {
        if (payload.CallSessionId is { } id)
            return await db.CallSessions.Include(c => c.Patient).FirstOrDefaultAsync(c => c.Id == id, ct);

        if (!string.IsNullOrWhiteSpace(payload.ExternalCallId))
            return await db.CallSessions.Include(c => c.Patient)
                .FirstOrDefaultAsync(c => c.ExternalCallId == payload.ExternalCallId, ct);

        return null;
    }

    private static CallOutcome MapOutcome(string? status, string transcript) =>
        status?.ToLowerInvariant() switch
        {
            "no_answer" or "no-answer" or "noanswer" or "missed" => CallOutcome.NoAnswer,
            "failed" or "error" or "busy" => CallOutcome.Failed,
            "refused" or "declined" or "rejected" => CallOutcome.Refused,
            _ => string.IsNullOrWhiteSpace(transcript) ? CallOutcome.NoAnswer : CallOutcome.Completed
        };
}
