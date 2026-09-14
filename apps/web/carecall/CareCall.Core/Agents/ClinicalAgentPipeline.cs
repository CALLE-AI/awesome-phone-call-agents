using System.Text;
using System.Text.Json;
using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CareCall.Core.Agents;

/// <summary>Consolidated result of the agentic pipeline.</summary>
public record PipelineResult(
    SymptomAssessmentDto Assessment,
    TrendAnalysisDto? Trend,
    ChallengeDto? Challenge,
    HandoffNoteDto? Handoff,
    SchedulingProposalDto? Scheduling);

/// <summary>
/// Orchestrates the agents in a deterministic sequence:
///   Trend Analyst -> Analyst -> Devil's Advocate (conditional) -> Handoff -> Scheduler
///
/// We deliberately do NOT use AgentGroupChat or autonomous conversation between agents:
/// in a clinical setting we need the result to be reproducible and auditable.
///
/// Each agent is isolated: if one fails, the pipeline continues. We never lose
/// a call because of an AI failure.
/// </summary>
public class ClinicalAgentPipeline(
    CallEDbContext db,
    IClinicalAiService analyst,
    ITrendAnalystAgent trendAnalyst,
    IDevilsAdvocateAgent devilsAdvocate,
    IClinicalHandoffAgent handoff,
    IAdaptiveSchedulerAgent scheduler,
    ILogger<ClinicalAgentPipeline> logger)
{
    public async Task<PipelineResult> RunAsync(
        CallSession session,
        Patient patient,
        string transcript,
        CancellationToken ct = default)
    {
        var history = await LoadHistoryAsync(patient.Id, session.Id, ct);
        var context = new AgentContext(patient, history, transcript);

        async Task RecordAsync(AgentTrace trace)
        {
            db.AgentTraces.Add(trace);
            await db.SaveChangesAsync(ct);
        }

        // 1. Longitudinal trend: what the series reveals that a single call does not.
        var trendRun = await trendAnalyst.AnalyzeAsync(context, ct);
        var trend = trendRun.Value;
        await RecordAsync(Trace(session, patient, AgentKind.TrendAnalyst, trendRun,
            trend?.Trajectory ?? "No trend result", trend?.Rationale));

        // 2. Analysis of the current call, enriched with the trend.
        var assessment = await analyst.AnalyzeTranscriptAsync(
            transcript, patient, BuildPreviousContext(context, trend), ct);

        await RecordAsync(new AgentTrace
        {
            CallSessionId = session.Id,
            PatientId = patient.Id,
            Agent = AgentKind.Analyst,
            Outcome = $"Risk {assessment.RiskClassification}, worsening {assessment.WorseningDetected}",
            Rationale = assessment.Summary,
            RawJson = JsonSerializer.Serialize(assessment),
            Succeeded = true
        });

        // The trend can reveal worsening even if the isolated call does not.
        if (trend?.GradualDeteriorationDetected == true && !assessment.WorseningDetected)
        {
            assessment.WorseningDetected = true;
            logger.LogInformation(
                "Gradual worsening detected from the historical series for {Patient}.", patient.Name);
        }

        // 3. Safety reviewer, only when the decision is dangerous or doubtful.
        ChallengeDto? challenge = null;
        if (DevilsAdvocateAgent.ShouldReview(assessment, transcript))
        {
            var challengeRun = await devilsAdvocate.ChallengeAsync(context, assessment, ct);
            challenge = challengeRun.Value;

            await RecordAsync(Trace(session, patient, AgentKind.DevilsAdvocate, challengeRun,
                challenge is null ? "Safety review unavailable" : challenge.ChallengeFound
                    ? $"Challenge {(challenge.QuoteVerified ? "upheld" : "unverified")}: {challenge.OverriddenRisk?.ToString() ?? "no override"}"
                    : "No challenge",
                challenge?.Rationale));

            if (challenge is not null)
            {
                // Only alters the risk if the literal quote was verified against the transcript.
                if (challenge.OverriddenRisk is { } newRisk && challenge.QuoteVerified)
                {
                    logger.LogInformation(
                        "Devil's advocate raises the risk from {Old} to {New} for {Patient}. Quote: {Quote}",
                        assessment.RiskClassification, newRisk, patient.Name, challenge.SupportingQuote);

                    assessment.RiskClassification = newRisk;
                }
            }
        }

        // 4. SBAR note for the clinician.
        var handoffRun = await handoff.WriteAsync(context, assessment, ct);
        await RecordAsync(Trace(session, patient, AgentKind.ClinicalHandoff, handoffRun,
            handoffRun.Value is { } note ? Truncate(note.Recommendation, 500) : "Handoff unavailable",
            handoffRun.Value?.Assessment));

        // 5. Next call.
        var schedulingRun = await scheduler.ProposeAsync(context, assessment, ct);
        await RecordAsync(Trace(session, patient, AgentKind.AdaptiveScheduler, schedulingRun,
            schedulingRun.Value is { } proposal
                ? proposal.DischargeFollowUp
                    ? "Follow-up complete"
                    : $"Next call in {proposal.NextCallInDays} day(s)"
                : "Scheduling proposal unavailable",
            schedulingRun.Value?.Rationale));

        return new PipelineResult(assessment, trend, challenge, handoffRun.Value, schedulingRun.Value);
    }

    /// <summary>History of already assessed calls, excluding the current one.</summary>
    private async Task<List<HistoryEntry>> LoadHistoryAsync(Guid patientId, Guid currentSessionId, CancellationToken ct)
    {
        var sessions = await db.CallSessions
            .AsNoTracking()
            .Include(c => c.Assessment)
            .Where(c => c.PatientId == patientId && c.Id != currentSessionId && c.Outcome != CallOutcome.Pending)
            .OrderBy(c => c.DateTime)
            .ToListAsync(ct);

        return [.. sessions.Select(s => new HistoryEntry(
            s.DateTime,
            s.Outcome,
            s.Assessment?.RiskClassification ?? RiskLevel.Low,
            s.Assessment?.WorseningDetected ?? false,
            s.Assessment?.ExtractedSymptoms ?? [],
            s.Assessment?.Summary ?? "(not assessed)"))];
    }

    /// <summary>Previous context for the analyst: previous summary plus the trend.</summary>
    private static string? BuildPreviousContext(AgentContext context, TrendAnalysisDto? trend)
    {
        var sb = new StringBuilder();

        if (context.Previous is { } prev)
            sb.AppendLine(prev.Summary);

        if (trend is not null && trend.Trajectory != "Unknown")
        {
            sb.AppendLine();
            sb.AppendLine($"Trend across all calls: {trend.Trajectory}.");
            if (trend.ProgressiveFindings.Count > 0)
                sb.AppendLine($"Progressive findings: {string.Join(", ", trend.ProgressiveFindings)}.");
        }

        var result = sb.ToString().Trim();
        return result.Length == 0 ? null : result;
    }

    private static AgentTrace Trace<T>(
        CallSession session, Patient patient, AgentKind kind,
        AgentRun<T> run, string outcome, string? rationale) => new()
        {
            CallSessionId = session.Id,
            PatientId = patient.Id,
            Agent = kind,
            Outcome = Truncate(outcome, 500),
            Rationale = Truncate(rationale ?? string.Empty, 2000),
            RawJson = run.RawJson,
            Succeeded = run.Succeeded,
            ElapsedMs = run.ElapsedMs
        };

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max];
}
