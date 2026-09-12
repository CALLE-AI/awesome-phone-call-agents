using CareCall.Core.Domain;

namespace CareCall.Core.Abstractions;

/// <summary>Salida estructurada esperada del LLM.</summary>
public class SymptomAssessmentDto
{
    public List<string> Symptoms { get; set; } = [];
    public RiskLevel RiskClassification { get; set; } = RiskLevel.Low;
    public string Summary { get; set; } = string.Empty;
    public bool WorseningDetected { get; set; }
}

/// <summary>Analisis clinico de transcripciones mediante Semantic Kernel.</summary>
public interface IClinicalAiService
{
    Task<string> GenerateSimulatedTranscriptAsync(
        Patient patient,
        IReadOnlyList<string> questions,
        CancellationToken ct = default);

    Task<SymptomAssessmentDto> AnalyzeTranscriptAsync(
        string transcript,
        Patient patient,
        string? previousSummary = null,
        CancellationToken ct = default);
}
