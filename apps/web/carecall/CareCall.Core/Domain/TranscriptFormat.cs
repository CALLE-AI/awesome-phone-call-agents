namespace CareCall.Core.Domain;

public enum Speaker
{
    Agent = 0,
    Patient = 1
}

public record TranscriptTurn(Speaker Speaker, string Text);

/// <summary>
/// Canonical transcript format: one line per turn with a speaker prefix.
/// Ingestion (CALL-E SDK) normalizes roles here; the UI only consumes Parse.
/// </summary>
public static class TranscriptFormat
{
    public const string AgentPrefix = "CALL-E:";
    public const string PatientPrefix = "Patient:";
    private const string LegacyPatientPrefix = "Paciente:";

    /// <summary>Converts the turns returned by the platform into the persisted text.</summary>
    public static string Build(IEnumerable<TranscriptTurn> turns) =>
        string.Join(Environment.NewLine, turns
            .Where(t => !string.IsNullOrWhiteSpace(t.Text))
            .Select(t => $"{(t.Speaker == Speaker.Agent ? AgentPrefix : PatientPrefix)} {t.Text.Trim()}"));

    /// <summary>Maps the provider's raw role (assistant/bot/agent vs user/customer/human).</summary>
    public static Speaker MapRole(string? role) => role?.Trim().ToLowerInvariant() switch
    {
        "assistant" or "agent" or "bot" or "ai" or "system" or "calle" or "call-e" => Speaker.Agent,
        _ => Speaker.Patient
    };

    /// <summary>Reads the persisted text. If the prefix is missing, applies a reasonable fallback.</summary>
    public static IReadOnlyList<TranscriptTurn> Parse(string? transcript)
    {
        if (string.IsNullOrWhiteSpace(transcript)) return [];

        string[] separators = ["\r\n", "\n", " - "];
        var parts = transcript.Split(separators, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        var turns = new List<TranscriptTurn>(parts.Length);

        // No diarization: strict alternation. The first turn is opened by whoever asks.
        var expected = parts.Length > 0 && !parts[0].Contains('?') && parts.Skip(1).FirstOrDefault()?.Contains('?') == true
            ? Speaker.Patient
            : Speaker.Agent;

        foreach (var part in parts)
        {
            string text = part;
            Speaker speaker;

            if (text.StartsWith(AgentPrefix, StringComparison.OrdinalIgnoreCase))
            {
                speaker = Speaker.Agent;
                text = text[AgentPrefix.Length..].Trim();
            }
            else if (text.StartsWith(PatientPrefix, StringComparison.OrdinalIgnoreCase))
            {
                speaker = Speaker.Patient;
                text = text[PatientPrefix.Length..].Trim();
            }
            else if (text.StartsWith(LegacyPatientPrefix, StringComparison.OrdinalIgnoreCase))
            {
                speaker = Speaker.Patient;
                text = text[LegacyPatientPrefix.Length..].Trim();
            }
            else
            {
                speaker = expected;
            }

            if (text.Length == 0) continue;

            expected = speaker == Speaker.Agent ? Speaker.Patient : Speaker.Agent;
            turns.Add(new TranscriptTurn(speaker, text));
        }

        return turns;
    }
}
