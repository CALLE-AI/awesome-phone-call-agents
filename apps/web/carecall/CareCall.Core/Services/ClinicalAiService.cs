using CareCall.Core.Abstractions;
using CareCall.Core.Domain;
using Microsoft.Extensions.Logging;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;

namespace CareCall.Core.Services;

/// <summary>
/// Analyzes the call transcript with a single LLM invocation
/// and returns typed JSON. We don't need agents for this.
/// </summary>
public class ClinicalAiService(Kernel kernel, ILogger<ClinicalAiService> logger) : IClinicalAiService
{
    private const string SystemPrompt = """
        You are a clinical assistant analysing transcripts of follow-up calls to
        patients discharged from the emergency department.

        Analyse the conversation and reply ONLY with a valid JSON object, with no
        extra text and no code fences, using exactly this schema:

        {
          "symptoms": ["symptom reported by the patient", "..."],
          "riskClassification": "Low" | "Medium" | "High",
          "summary": "brief clinical summary in English, maximum 3 sentences",
          "worseningDetected": true | false
        }

        Always write "symptoms" and "summary" in English, regardless of the
        language spoken in the transcript.

        Risk criteria:
        - High: red flags (chest pain, dyspnea at rest, persistent high fever,
          bleeding, confusion, syncope), clear deterioration, or non-adherence to
          critical medication.
        - Medium: persistent or bothersome symptoms without red flags, relevant doubts.
        - Low: favourable progress or mild symptoms expected after discharge.

        "worseningDetected" is true only if the condition has worsened compared with
        the previous summary, or if the patient reports a clear deterioration since discharge.

        Be conservative: when information is ambiguous or insufficient, do not
        underestimate the risk. If the transcript is empty or the patient did not
        answer, use risk "Low", an empty symptom list, and explain it in the summary.
        """;

    public async Task<string> GenerateSimulatedTranscriptAsync(
        Patient patient,
        IReadOnlyList<string> questions,
        CancellationToken ct = default)
    {
        var chat = kernel.GetRequiredService<IChatCompletionService>();
        var history = new ChatHistory("""
            Generate a fictional follow-up call transcript for a product demo.
            Write a concise English dialogue using CALL-E and Patient labels. Ask every
            supplied question in the original order and give natural patient answers.
            The patient should describe mild, improving symptoms and medication adherence.
            Do not give medical advice, mention emergency symptoms, or add any text outside the transcript.
            """);
        history.AddUserMessage($"""
            Patient: {patient.Name}
            Discharge diagnosis: {patient.Diagnosis}
            Questions:
            {string.Join(Environment.NewLine, questions.Select((question, index) => $"{index + 1}. {question}"))}
            """);

        try
        {
            var response = await chat.GetChatMessageContentAsync(history,
                new OpenAIPromptExecutionSettings { Temperature = 0.4, MaxTokens = 600 }, kernel, ct);
            if (!string.IsNullOrWhiteSpace(response.Content)) return response.Content;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Failed to generate simulated transcript for {PatientId}.", patient.Id);
        }

        return BuildFallbackTranscript(patient, questions);
    }

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

    public async Task<SymptomAssessmentDto> AnalyzeTranscriptAsync(
        string transcript,
        Patient patient,
        string? previousSummary = null,
        CancellationToken ct = default)
    {
        var chat = kernel.GetRequiredService<IChatCompletionService>();

        var history = new ChatHistory(SystemPrompt);
        history.AddUserMessage($"""
            Patient: {patient.Name} ({patient.Age} years old)
            Discharge diagnosis: {patient.Diagnosis}
            Discharge date: {patient.DischargeDate:yyyy-MM-dd}
            Recorded risk level: {patient.RiskLevel}

            Previous call summary:
            {(string.IsNullOrWhiteSpace(previousSummary) ? "(no previous calls)" : previousSummary)}

            Current call transcript:
            {(string.IsNullOrWhiteSpace(transcript) ? "(no transcript)" : transcript)}
            """);

        var settings = new OpenAIPromptExecutionSettings
        {
            Temperature = 0.1,
            MaxTokens = 800,
            ResponseFormat = "json_object"
        };

        try
        {
            var response = await chat.GetChatMessageContentAsync(history, settings, kernel, ct);

            if (AssessmentParser.TryParse(response.Content, out var dto))
                return dto;

            logger.LogWarning("Could not parse the LLM response: {Raw}", response.Content);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Failed to analyze the transcript for patient {PatientId}.", patient.Id);
        }

        // Safe fallback: we never lose the call due to an AI failure.
        return new SymptomAssessmentDto
        {
            Symptoms = [],
            RiskClassification = RiskLevel.Medium,
            Summary = "The call could not be analysed automatically. Manual review required.",
            WorseningDetected = false
        };
    }
}
