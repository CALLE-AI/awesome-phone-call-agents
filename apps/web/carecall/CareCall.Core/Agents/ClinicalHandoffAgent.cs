using System.Text;
using CareCall.Core.Abstractions;
using CareCall.Core.Domain;

namespace CareCall.Core.Agents;

/// <summary>
/// Drafts the clinical handoff note in SBAR format, the standard already used by
/// healthcare staff. Converts the AI output into something a
/// professional can read at a glance and act on.
/// </summary>
public class ClinicalHandoffAgent(AgentRunner runner) : IClinicalHandoffAgent
{
    private const string SystemPrompt = """
        You are a clinical documentation assistant. Write a concise SBAR handover note
        for the healthcare professional who will review a post-discharge follow-up call.

        Reply ONLY with a valid JSON object, no extra text and no code fences:

        {
          "situation": "why this patient is being flagged right now, 1-2 sentences",
          "background": "relevant discharge context and previous follow-up, 1-2 sentences",
          "assessment": "clinical interpretation of the current call, 1-2 sentences",
          "recommendation": "concrete next action for the clinician, 1-2 sentences"
        }

        Rules:
        - Base the note ONLY on the information provided. Never invent vital signs,
          test results or findings that were not reported.
        - Be specific and factual. Prefer the patient's reported facts over adjectives.
        - "recommendation" must be actionable (e.g. "Telephone review within 24h",
          "Advise attending the emergency department today", "Continue routine follow-up").
        - You are supporting a clinical decision, not making it: never state a
          diagnosis and never prescribe or change treatment.
        - Write in English, in professional clinical register.
        """;

    public Task<AgentRun<HandoffNoteDto>> WriteAsync(
        AgentContext context,
        SymptomAssessmentDto assessment,
        CancellationToken ct = default)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Patient: {context.Patient.Name}, {context.Patient.Age} years old");
        sb.AppendLine($"Discharge diagnosis: {context.Patient.Diagnosis}");
        sb.AppendLine($"Discharged on: {context.Patient.DischargeDate:yyyy-MM-dd} " +
                      $"({(DateTime.UtcNow - context.Patient.DischargeDate).Days} days ago)");
        sb.AppendLine($"Risk level on discharge: {context.Patient.RiskLevel}");
        sb.AppendLine($"Follow-up call number: {context.CallNumber}");

        if (context.Previous is { } prev)
        {
            sb.AppendLine();
            sb.AppendLine($"Previous call ({prev.When:yyyy-MM-dd}): risk {prev.Risk}");
            sb.AppendLine($"  {prev.Summary}");
        }

        sb.AppendLine();
        sb.AppendLine("Current call assessment:");
        sb.AppendLine($"  Risk: {assessment.RiskClassification}");
        sb.AppendLine($"  Worsening detected: {assessment.WorseningDetected}");
        sb.AppendLine($"  Symptoms: {(assessment.Symptoms.Count == 0 ? "(none reported)" : string.Join(", ", assessment.Symptoms))}");
        sb.AppendLine($"  Summary: {assessment.Summary}");

        if (!string.IsNullOrWhiteSpace(context.Transcript))
        {
            sb.AppendLine();
            sb.AppendLine("Call transcript:");
            sb.AppendLine(context.Transcript);
        }

        return runner.RunAsync<HandoffNoteDto>(
            nameof(ClinicalHandoffAgent), SystemPrompt, sb.ToString(), ct);
    }
}
