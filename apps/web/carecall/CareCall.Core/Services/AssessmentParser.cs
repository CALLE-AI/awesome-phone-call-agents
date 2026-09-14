using System.Text.Json;
using System.Text.Json.Serialization;
using CareCall.Core.Abstractions;
using CareCall.Core.Domain;

namespace CareCall.Core.Services;

/// <summary>
/// Defensive parsing of the LLM output. The model sometimes wraps the JSON in
/// markdown fences or adds extra text, so we extract the first valid JSON object.
/// </summary>
public static class AssessmentParser
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public static bool TryParse(string? raw, out SymptomAssessmentDto dto)
    {
        dto = new SymptomAssessmentDto();
        if (string.IsNullOrWhiteSpace(raw)) return false;

        var json = ExtractJsonObject(raw);
        if (json is null) return false;

        try
        {
            var parsed = JsonSerializer.Deserialize<RawAssessment>(json, Options);
            if (parsed is null) return false;

            dto = new SymptomAssessmentDto
            {
                Symptoms = parsed.Symptoms ?? [],
                Summary = parsed.Summary ?? string.Empty,
                WorseningDetected = parsed.WorseningDetected,
                RiskClassification = MapRisk(parsed.RiskClassification)
            };
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>Locates the first balanced JSON object, ignoring markdown fences.</summary>
    internal static string? ExtractJsonObject(string raw)
    {
        var start = raw.IndexOf('{');
        if (start < 0) return null;

        var depth = 0;
        var inString = false;
        var escaped = false;

        for (var i = start; i < raw.Length; i++)
        {
            var c = raw[i];

            if (inString)
            {
                if (escaped) escaped = false;
                else if (c == '\\') escaped = true;
                else if (c == '"') inString = false;
                continue;
            }

            switch (c)
            {
                case '"': inString = true; break;
                case '{': depth++; break;
                case '}':
                    depth--;
                    if (depth == 0) return raw[start..(i + 1)];
                    break;
            }
        }

        return null;
    }

    /// <summary>Accepts integers, English and Spanish; when in doubt, do not underrate the risk.</summary>
    internal static RiskLevel MapRisk(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return RiskLevel.Low;

        if (int.TryParse(value, out var n))
            return n switch { <= 0 => RiskLevel.Low, 1 => RiskLevel.Medium, _ => RiskLevel.High };

        return value.Trim().ToLowerInvariant() switch
        {
            "low" or "bajo" or "baja" or "leve" => RiskLevel.Low,
            "medium" or "moderate" or "medio" or "media" or "moderado" => RiskLevel.Medium,
            "high" or "critical" or "alto" or "alta" or "grave" or "critico" => RiskLevel.High,
            _ => RiskLevel.Medium
        };
    }

    private sealed class RawAssessment
    {
        public List<string>? Symptoms { get; set; }
        public string? RiskClassification { get; set; }
        public string? Summary { get; set; }
        public bool WorseningDetected { get; set; }
    }
}
