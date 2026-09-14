using System.Text;
using CareCall.Core.Agents;

namespace CareCall.Core.Agents;

/// <summary>
/// Analyzes the SERIES of calls, not just the last one. Detects gradual
/// deteriorations that no isolated call reveals (e.g. fever 37.8 -> 38.2 -> 39.2).
/// </summary>
public class TrendAnalystAgent(AgentRunner runner) : ITrendAnalystAgent
{
    private const string SystemPrompt = """
        You are a clinical trend analyst reviewing the FULL history of follow-up calls
        for a patient discharged from the emergency department.

        Your job is NOT to analyse a single call: it is to detect patterns ACROSS calls
        that no individual call reveals on its own, such as a symptom that intensifies
        progressively, adherence that degrades, or a complaint that keeps reappearing.

        Reply ONLY with a valid JSON object, no extra text and no code fences:

        {
          "trajectory": "Improving" | "Stable" | "Worsening" | "Unknown",
          "progressiveFindings": ["finding that worsens across calls", "..."],
          "gradualDeteriorationDetected": true | false,
          "rationale": "1-2 sentences citing the progression across calls"
        }

        Rules:
        - Base every conclusion ONLY on the calls provided. Never invent findings.
        - "gradualDeteriorationDetected" is true only when a measurable or clearly
          described worsening spans two or more calls.
        - With fewer than two completed calls, use "Unknown" and false: there is no
          trend to analyse yet.
        - Write in English.
        """;

    public async Task<AgentRun<TrendAnalysisDto>> AnalyzeAsync(AgentContext context, CancellationToken ct = default)
    {
        // Without at least two assessed calls there is no series: we skip the invocation.
        if (context.History.Count < 2)
        {
            var empty = new TrendAnalysisDto
            {
                Trajectory = "Unknown",
                GradualDeteriorationDetected = false,
                Rationale = "Not enough completed calls to establish a trend."
            };
            return new AgentRun<TrendAnalysisDto>(empty, string.Empty, 0, true);
        }

        var sb = new StringBuilder();
        sb.AppendLine($"Patient: {context.Patient.Name} ({context.Patient.Age} years old)");
        sb.AppendLine($"Discharge diagnosis: {context.Patient.Diagnosis}");
        sb.AppendLine($"Discharge date: {context.Patient.DischargeDate:yyyy-MM-dd}");
        sb.AppendLine();
        sb.AppendLine("Follow-up call history, oldest first:");

        for (var i = 0; i < context.History.Count; i++)
        {
            var h = context.History[i];
            sb.AppendLine();
            sb.AppendLine($"Call {i + 1} - {h.When:yyyy-MM-dd HH:mm} - outcome: {h.Outcome}");
            sb.AppendLine($"  Risk: {h.Risk}, worsening flagged: {h.WorseningDetected}");
            sb.AppendLine($"  Symptoms: {(h.Symptoms.Count == 0 ? "(none recorded)" : string.Join(", ", h.Symptoms))}");
            sb.AppendLine($"  Summary: {h.Summary}");
        }

        if (!string.IsNullOrWhiteSpace(context.Transcript))
        {
            sb.AppendLine();
            sb.AppendLine("Transcript of the most recent call:");
            sb.AppendLine(context.Transcript);
        }

        return await runner.RunAsync<TrendAnalysisDto>(
            nameof(TrendAnalystAgent), SystemPrompt, sb.ToString(), ct);
    }
}
