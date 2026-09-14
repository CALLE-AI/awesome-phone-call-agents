using System.Text.Json;
using CareCall.Core.Abstractions;
using CareCall.Core.Agents;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace CareCall.Core.Services;

/// <summary>
/// Places real follow-up calls through the CALL-E REST API.
/// </summary>
public class CallEService(
    CallEApiClient api,
    CallEOptions options,
    CallEDbContext db,
    ILogger<CallEService> logger,
    IQuestionPlannerAgent? planner = null,
    CallIngestionService? ingestion = null,
    IClinicalAiService? clinicalAi = null) : ICallEService
{
    public async Task<CallSession> StartCallAsync(Patient patient, FollowUpContext context, CancellationToken ct = default)
    {
        var session = new CallSession
        {
            PatientId = patient.Id,
            DateTime = DateTime.UtcNow,
            Outcome = CallOutcome.Pending
        };

        db.CallSessions.Add(session);
        await db.SaveChangesAsync(ct);

        var plan = await PlanQuestionsAsync(patient, context, session, ct);

        if (options.SimulateCalls)
        {
            logger.LogInformation("CALL-E simulation: no provider call submitted for {Patient}.", patient.Name);
            if (ingestion is not null)
            {
                await ingestion.IngestAsync(new CallCompletedPayload(
                    ExternalCallId: null,
                    CallSessionId: session.Id,
                    Transcript: "[SIMULATED CALL — no telephone provider contacted]" + Environment.NewLine
                        + await BuildSimulatedTranscriptAsync(patient, plan, ct),
                    DurationSeconds: 90,
                    Status: "completed"), ct);
            }
            return session;
        }

        if (!options.Enabled || !options.IsConfigured)
        {
            logger.LogWarning("CALL-E disabled or missing ApiKey; the call for {Patient} remains pending.", patient.Name);
            return session;
        }

        // Limited quota during the hackathon: we never exceed it.
        var consumed = await db.CallSessions.CountAsync(c => c.ExternalCallId != null, ct);
        if (consumed >= options.CallBudget)
        {
            logger.LogError("Call budget exhausted ({Budget}). The call will not be placed.", options.CallBudget);
            session.Outcome = CallOutcome.Failed;
            await db.SaveChangesAsync(ct);
            return session;
        }

        try
        {
            var response = await api.CreateCallAsync(
                phone: options.DemoPhoneNumber ?? patient.PhoneNumber,
                task: BuildTask(context, plan),
                region: options.Region,
                locale: options.Locale,
                // The session id is stable: it avoids duplicate calls on retries.
                idempotencyKey: session.Id.ToString(),
                webhookUrl: options.WebhookUrl,
                metadata: new Dictionary<string, string>
                {
                    ["call_session_id"] = session.Id.ToString(),
                    ["patient_id"] = patient.Id.ToString()
                },
                ct);

            session.ExternalCallId = JsonReader.FindString(response, ["call_id", "id", "callId"]);
            await db.SaveChangesAsync(ct);

            logger.LogInformation("CALL-E call {ExternalId} started for {Patient}.", session.ExternalCallId, patient.Name);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError("Could not start the call ({ErrorType}). Session: {SessionId}.", ex.GetType().Name, session.Id);
            session.Outcome = CallOutcome.Failed;
            await db.SaveChangesAsync(ct);
        }

        return session;
    }

    private Task<string> BuildSimulatedTranscriptAsync(
        Patient patient, QuestionPlanDto? plan, CancellationToken ct) =>
        clinicalAi is not null
            ? clinicalAi.GenerateSimulatedTranscriptAsync(patient, plan?.Questions ?? [], ct)
            : Task.FromResult(BuildFallbackTranscript(patient, plan?.Questions ?? []));

    private static string BuildFallbackTranscript(Patient patient, IReadOnlyList<string> questions)
    {
        var lines = new List<string> { $"CALL-E: Hello {patient.Name}. How are you feeling today?" };
        foreach (var question in questions)
        {
            lines.Add($"CALL-E: {question}");
            lines.Add("Patient: I am improving, with only a mild occasional cough. I am taking my medication as prescribed.");
        }
        return string.Join(Environment.NewLine, lines);
    }

    /// <summary>
    /// Asks the planner for personalized questions. If it fails we return null and
    /// the call still goes out with the static script: we never leave a patient
    /// without follow-up because of an AI failure.
    /// </summary>
    private async Task<QuestionPlanDto?> PlanQuestionsAsync(
        Patient patient, FollowUpContext context, CallSession session, CancellationToken ct)
    {
        if (planner is null) return null;

        try
        {
            var history = await db.CallSessions
                .AsNoTracking()
                .Include(c => c.Assessment)
                .Where(c => c.PatientId == patient.Id && c.Id != session.Id && c.Outcome != CallOutcome.Pending)
                .OrderBy(c => c.DateTime)
                .ToListAsync(ct);

            var entries = history
                .Select(s => new HistoryEntry(
                    s.DateTime,
                    s.Outcome,
                    s.Assessment?.RiskClassification ?? RiskLevel.Low,
                    s.Assessment?.WorseningDetected ?? false,
                    s.Assessment?.ExtractedSymptoms ?? [],
                    s.Assessment?.Summary ?? "(not assessed)"))
                .ToList();

            var run = await planner.PlanAsync(new AgentContext(patient, entries), ct);

            db.AgentTraces.Add(new AgentTrace
            {
                CallSessionId = session.Id,
                PatientId = patient.Id,
                Agent = AgentKind.QuestionPlanner,
                Outcome = run.Value is null
                    ? "Planning failed, static script used"
                    : $"{run.Value.Questions.Count} question(s) planned",
                Rationale = run.Value?.Rationale ?? string.Empty,
                RawJson = run.RawJson,
                Succeeded = run.Succeeded,
                ElapsedMs = run.ElapsedMs
            });
            await db.SaveChangesAsync(ct);

            return run.Value is { Questions.Count: > 0 } ? run.Value : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "The question planner failed for {Patient}; using the static script.", patient.Name);
            return null;
        }
    }

    /// <summary>Script followed by the CALL-E agent during the call.</summary>
    private static string BuildTask(FollowUpContext c, QuestionPlanDto? plan = null) => $"""
        You are CALL-E, a follow-up assistant from the hospital emergency department.
        Speak in a calm, warm and respectful tone. The patient may be an elderly person:
        use short sentences, avoid medical jargon, and give them time to answer.

        You are calling {c.PatientName}, discharged on {c.DischargeDate:dd/MM/yyyy}
        with a diagnosis of {c.Diagnosis}. This is follow-up call number {c.CallNumber}.
        {(string.IsNullOrWhiteSpace(c.PreviousSummary) ? "" : $"Summary of the previous call: {c.PreviousSummary}")}

        {BuildGoals(plan)}

        Do not give a diagnosis, do not change their treatment, and do not give medical advice.
        If you detect a warning sign, clearly tell them to contact their doctor or go to
        the emergency department. Keep the call under 4 minutes.

        If the patient does not answer personally, do not discuss any health details.
        """;

    /// <summary>Personalized questions if the planner responded; otherwise, the usual script.</summary>
    private static string BuildGoals(QuestionPlanDto? plan)
    {
        if (plan is null || plan.Questions.Count == 0)
            return """
                Conversation goals:
                1. Ask how they have been feeling since discharge.
                2. Ask about symptoms related to their diagnosis, and whether these have improved or worsened.
                3. Confirm they are taking the prescribed medication.
                4. Check for warning signs: chest pain, difficulty breathing, high fever,
                   bleeding, confusion or severe dizziness.
                5. Say goodbye, reminding them to go to the emergency department or call 112
                   if they get worse.
                """;

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("Ask the following questions, in this order:");

        for (var i = 0; i < plan.Questions.Count; i++)
            sb.AppendLine($"{i + 1}. {plan.Questions[i]}");

        sb.AppendLine($"{plan.Questions.Count + 1}. Say goodbye, reminding them to go to the emergency " +
                      "department or call 112 if they get worse.");

        if (plan.RedFlags.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Listen carefully for these warning signs and, if any appears, tell the patient " +
                          "to seek urgent care: " + string.Join("; ", plan.RedFlags) + ".");
        }

        return sb.ToString().TrimEnd();
    }
}

/// <summary>Lectura tolerante de campos en JSON de respuesta.</summary>
public static class JsonReader
{
    public static string? FindString(JsonElement element, string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;

        foreach (var name in names)
            if (element.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            {
                var s = v.GetString();
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }

        foreach (var prop in element.EnumerateObject())
            if (prop.Value.ValueKind == JsonValueKind.Object)
            {
                var nested = FindString(prop.Value, names);
                if (nested is not null) return nested;
            }

        return null;
    }
}
