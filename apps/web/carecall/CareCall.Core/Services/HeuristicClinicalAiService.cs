using CareCall.Core.Abstractions;
using CareCall.Core.Domain;
using Microsoft.Extensions.Logging;

namespace CareCall.Core.Services;

/// <summary>
/// Fallback without an LLM: allows the full flow to run offline or without credentials.
/// Classifies based on keywords found in the transcript.
/// </summary>
public class HeuristicClinicalAiService(ILogger<HeuristicClinicalAiService> logger) : IClinicalAiService
{
    private static readonly (string Term, string Symptom)[] Vocabulary =
    [
        ("fever", "fever"), ("fiebre", "fever"),
        ("pain", "pain"), ("dolor", "pain"),
        ("cough", "cough"), ("tos", "cough"),
        ("breath", "shortness of breath"), ("ahog", "shortness of breath"),
        ("dizz", "dizziness"), ("mareo", "dizziness"),
        ("vomit", "vomiting"), ("nausea", "nausea"),
        ("bleed", "bleeding"), ("sangr", "bleeding"),
        ("swell", "swelling"), ("hinch", "swelling"),
        ("chest", "chest discomfort"), ("pecho", "chest discomfort")
    ];

    private static readonly string[] WorseningTerms =
    ["worse", "peor", "empeor", "more pain", "can't breathe", "cannot breathe", "no puedo respirar", "urgen", "emergency"];

    private static readonly string[] CriticalTerms =
    ["chest", "pecho", "breath", "respirar", "bleed", "sangr", "faint", "desmay"];

    public Task<string> GenerateSimulatedTranscriptAsync(
        Patient patient,
        IReadOnlyList<string> questions,
        CancellationToken ct = default)
    {
        var lines = new List<string> { $"CALL-E: Hello {patient.Name}. How are you feeling today?" };
        foreach (var question in questions)
        {
            lines.Add($"CALL-E: {question}");
            lines.Add("Patient: I am improving, with only a mild occasional cough. I am taking my medication as prescribed.");
        }
        return Task.FromResult(string.Join(Environment.NewLine, lines));
    }

    public Task<SymptomAssessmentDto> AnalyzeTranscriptAsync(
        string transcript,
        Patient patient,
        string? previousSummary = null,
        CancellationToken ct = default)
    {
        var text = (transcript ?? string.Empty).ToLowerInvariant();

        var symptoms = Vocabulary
            .Where(v => text.Contains(v.Term, StringComparison.Ordinal))
            .Select(v => v.Symptom)
            .Distinct()
            .ToList();

        var worsening = WorseningTerms.Any(t => text.Contains(t, StringComparison.Ordinal));
        var critical = CriticalTerms.Any(t => text.Contains(t, StringComparison.Ordinal));

        var risk = (critical, worsening, symptoms.Count) switch
        {
            (true, true, _) => RiskLevel.High,
            (true, false, _) => RiskLevel.Medium,
            (_, true, _) => RiskLevel.High,
            (_, _, >= 3) => RiskLevel.Medium,
            (_, _, >= 1) => RiskLevel.Low,
            _ => RiskLevel.Low
        };

        var summary = symptoms.Count == 0
            ? $"{patient.Name} reports no relevant symptoms during the follow-up call."
            : $"{patient.Name} reports {string.Join(", ", symptoms)}." +
              (worsening ? " Patient describes worsening since the previous call." : " No worsening reported.");

        logger.LogInformation("Analisis heuristico (sin LLM) para paciente {PatientId}: riesgo {Risk}.", patient.Id, risk);

        return Task.FromResult(new SymptomAssessmentDto
        {
            Symptoms = symptoms,
            RiskClassification = risk,
            Summary = summary,
            WorseningDetected = worsening
        });
    }
}
