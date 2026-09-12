using System.Text;
using CareCall.Core.Abstractions;
using CareCall.Core.Domain;

namespace CareCall.Core.Agents;

/// <summary>
/// Clinical safety reviewer. Looks ONLY for underestimated risk.
///
/// In testing, an unrestricted critic objected to 100% of cases,
/// even benign ones (it once invoked compartment syndrome for a fracture
/// with no symptoms). That's why the prompt requires a LITERAL patient quote and
/// forbids reasoning about hypothetical complications: without a verifiable quote,
/// the objection does not alter the risk (verification is done by code, not the model).
/// </summary>
public class DevilsAdvocateAgent(AgentRunner runner) : IDevilsAdvocateAgent
{
    /// <summary>Transcript length below which we consider the evidence scant.</summary>
    public const int ShortTranscriptThreshold = 400;

    private const string SystemPrompt = """
        You are a clinical safety reviewer auditing another AI's assessment of a
        post-discharge follow-up call. You are the last safeguard against a missed
        deterioration, but raising a false alarm has a real cost: it buries genuine
        alerts under noise.

        Your ONLY job is to detect UNDER-estimated risk. You may raise the risk level,
        never lower it.

        Reply ONLY with a valid JSON object, no extra text and no code fences:

        {
          "challengeFound": true | false,
          "overriddenRisk": "Low" | "Medium" | "High" | null,
          "supportingQuote": "exact words the patient said, copied verbatim" | null,
          "missedFindings": ["finding the original assessment overlooked", "..."],
          "rationale": "1-2 sentences"
        }

        Before objecting, apply this test to your candidate quote:
          "Does this quote, ON ITS OWN, describe something clinically ALARMING?"
        If the quote describes improvement, stability, or an expected symptom, the
        answer is NO and you MUST NOT object.

        STRICT RULES - an objection breaking any of these is invalid:
        1. "supportingQuote" MUST be a VERBATIM copy of the patient's words. Never
           paraphrase or translate.
        2. The quote must describe a NEW, WORSENING or ALARMING finding. Quotes
           reporting improvement ("much better", "less pain", "no numbness") can NEVER
           support an objection. An expected symptom that is resolving is not a red flag.
        3. NEVER raise risk over complications that are theoretically possible but NOT
           described in the transcript. Absence of evidence is not evidence.
           Speculating about what "could develop" is forbidden.
        4. You may raise the risk by ONE level at most (Low->Medium, Medium->High).
        5. If the assessment is adequate, reply challengeFound=false, overriddenRisk=null,
           supportingQuote=null. Most assessments ARE correct: this is the expected
           answer in routine cases. Never invent an objection to appear useful.

        Legitimate grounds: the patient describes a red flag the assessment ignored,
        reports stopping critical medication, contradicts the conclusion, or evades
        questions about key symptoms.

        Write in English.
        """;

    public async Task<AgentRun<ChallengeDto>> ChallengeAsync(
        AgentContext context,
        SymptomAssessmentDto assessment,
        CancellationToken ct = default)
    {
        var transcript = context.Transcript ?? string.Empty;

        var sb = new StringBuilder();
        sb.AppendLine($"Patient: {context.Patient.Name} ({context.Patient.Age} years old)");
        sb.AppendLine($"Discharge diagnosis: {context.Patient.Diagnosis}");
        sb.AppendLine($"Days since discharge: {(DateTime.UtcNow - context.Patient.DischargeDate).Days}");

        if (context.Previous is { } prev)
        {
            sb.AppendLine();
            sb.AppendLine($"Previous call risk: {prev.Risk}");
            sb.AppendLine($"Previous summary: {prev.Summary}");
        }

        sb.AppendLine();
        sb.AppendLine("Transcript of the call under review:");
        sb.AppendLine(string.IsNullOrWhiteSpace(transcript) ? "(no transcript)" : transcript);
        sb.AppendLine();
        sb.AppendLine("Assessment produced by the other AI:");
        sb.AppendLine($"  Risk: {assessment.RiskClassification}");
        sb.AppendLine($"  Worsening detected: {assessment.WorseningDetected}");
        sb.AppendLine($"  Symptoms: {(assessment.Symptoms.Count == 0 ? "(none)" : string.Join(", ", assessment.Symptoms))}");
        sb.AppendLine($"  Summary: {assessment.Summary}");

        var run = await runner.RunAsync<ChallengeDto>(
            nameof(DevilsAdvocateAgent), SystemPrompt, sb.ToString(), ct);

        if (run.Value is null) return run;

        // The model does not decide whether its quote is valid: the code checks it.
        var validated = Validate(run.Value, transcript, assessment.RiskClassification);
        return run with { Value = validated };
    }

    /// <summary>
    /// Applies in code the guarantees we cannot delegate to the prompt:
    /// the quote must exist in the transcript and the risk can only go up one level.
    /// </summary>
    internal static ChallengeDto Validate(ChallengeDto dto, string transcript, RiskLevel originalRisk)
    {
        dto.QuoteVerified = QuoteAppearsIn(dto.SupportingQuote, transcript);

        if (!dto.ChallengeFound || !dto.QuoteVerified)
        {
            // Without a verifiable quote the objection is kept as informative,
            // but it does not alter the risk.
            dto.OverriddenRisk = null;
            return dto;
        }

        if (dto.OverriddenRisk is not { } proposed || proposed <= originalRisk)
        {
            // Never lowers the risk or leaves it unchanged.
            dto.OverriddenRisk = null;
            return dto;
        }

        // At most one level above the original.
        var capped = (RiskLevel)Math.Min((int)proposed, (int)originalRisk + 1);
        dto.OverriddenRisk = capped;
        return dto;
    }

    /// <summary>
    /// Checks that the quote appears in the transcript. Tolerant of spacing,
    /// casing and trailing punctuation, strict about the content.
    /// </summary>
    internal static bool QuoteAppearsIn(string? quote, string transcript)
    {
        if (string.IsNullOrWhiteSpace(quote) || string.IsNullOrWhiteSpace(transcript)) return false;

        var needle = Normalize(quote);
        // Very short quotes ("yes", "no") prove nothing.
        if (needle.Length < 12) return false;

        return Normalize(transcript).Contains(needle, StringComparison.Ordinal);
    }

    private static string Normalize(string value)
    {
        var sb = new StringBuilder(value.Length);
        var lastWasSpace = false;

        foreach (var c in value.Trim().ToLowerInvariant())
        {
            if (char.IsWhiteSpace(c))
            {
                if (!lastWasSpace) { sb.Append(' '); lastWasSpace = true; }
                continue;
            }

            // We ignore punctuation: the model often trims or adds commas and periods.
            if (char.IsLetterOrDigit(c)) { sb.Append(c); lastWasSpace = false; }
        }

        return sb.ToString().Trim();
    }

    /// <summary>We only audit when the decision is dangerous or the evidence is scant.</summary>
    public static bool ShouldReview(SymptomAssessmentDto assessment, string? transcript) =>
        assessment.RiskClassification == RiskLevel.High
        || assessment.WorseningDetected
        || string.IsNullOrWhiteSpace(transcript)
        || transcript.Length < ShortTranscriptThreshold;
}
