using System.Text;
using CareCall.Core.Abstractions;
using CareCall.Core.Domain;

namespace CareCall.Core.Agents;

/// <summary>
/// Proposes when to call back based on the patient's evolution.
/// It is autonomous (writes to the follow-up plan), but the limits are enforced
/// in code: never before 24h and never beyond 14 days, no matter what
/// the prompt or the model say.
/// </summary>
public class AdaptiveSchedulerAgent(AgentRunner runner) : IAdaptiveSchedulerAgent
{
    /// <summary>Hard floor: we don't harass the patient with back-to-back calls.</summary>
    public const int MinDays = 1;

    /// <summary>Ceiling: beyond two weeks the follow-up loses its purpose.</summary>
    public const int MaxDays = 14;

    private const string SystemPrompt = """
        You are a follow-up planning assistant deciding when a discharged patient
        should receive their next automated follow-up call.

        Reply ONLY with a valid JSON object, no extra text and no code fences:

        {
          "nextCallInDays": <integer between 1 and 14>,
          "dischargeFollowUp": true | false,
          "rationale": "1-2 sentences justifying the interval"
        }

        Guidance:
        - Deterioration or high risk: call back in 1 day, and never discharge follow-up.
        - Persistent or moderate symptoms: 2-3 days.
        - Stable and improving: 5-7 days.
        - Fully recovered, no symptoms, treatment completed and the planned follow-up
          is finished: set "dischargeFollowUp" to true.
        - If the patient did not answer, keep the interval short (1-2 days) and never
          discharge follow-up: we have no information about them.

        Never set "dischargeFollowUp" to true when any red flag or worsening is present.
        Write in English.
        """;

    public async Task<AgentRun<SchedulingProposalDto>> ProposeAsync(
        AgentContext context,
        SymptomAssessmentDto assessment,
        CancellationToken ct = default)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Patient: {context.Patient.Name}, {context.Patient.Age} years old");
        sb.AppendLine($"Discharge diagnosis: {context.Patient.Diagnosis}");
        sb.AppendLine($"Days since discharge: {(DateTime.UtcNow - context.Patient.DischargeDate).Days}");
        sb.AppendLine($"Completed follow-up calls: {context.History.Count}");
        sb.AppendLine();
        sb.AppendLine("Latest assessment:");
        sb.AppendLine($"  Risk: {assessment.RiskClassification}");
        sb.AppendLine($"  Worsening detected: {assessment.WorseningDetected}");
        sb.AppendLine($"  Symptoms: {(assessment.Symptoms.Count == 0 ? "(none reported)" : string.Join(", ", assessment.Symptoms))}");
        sb.AppendLine($"  Summary: {assessment.Summary}");

        if (context.History.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Previous calls:");
            foreach (var h in context.History)
                sb.AppendLine($"  {h.When:yyyy-MM-dd} - {h.Outcome}, risk {h.Risk}: {h.Summary}");
        }

        var run = await runner.RunAsync<SchedulingProposalDto>(
            nameof(AdaptiveSchedulerAgent), SystemPrompt, sb.ToString(), ct);

        if (run.Value is null) return run;

        return run with { Value = ApplyGuardrails(run.Value, assessment) };
    }

    /// <summary>
    /// Non-negotiable limits. The model proposes, the code disposes: a prompt
    /// can be ignored, a check in code cannot.
    /// </summary>
    internal static SchedulingProposalDto ApplyGuardrails(
        SchedulingProposalDto proposal,
        SymptomAssessmentDto assessment)
    {
        proposal.NextCallInDays = Math.Clamp(proposal.NextCallInDays, MinDays, MaxDays);

        // We never close the follow-up for a patient who is worsening or at high risk.
        if (assessment.WorseningDetected || assessment.RiskClassification == RiskLevel.High)
        {
            proposal.DischargeFollowUp = false;
            proposal.NextCallInDays = MinDays;
        }

        return proposal;
    }
}
