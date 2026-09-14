using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace CareCall.Core.Services;

/// <summary>
/// Client for the CALL-E REST API (https://api.heycall-e.com).
/// Replaces the CLI: no Node processes, with a real webhook and idempotency.
/// </summary>
public class CallEApiClient(HttpClient http, CallEOptions options)
{
    /// <summary>
    /// POST /v1/calls. The schema forces CALL-E to return typed clinical data
    /// in addition to the transcript.
    /// </summary>
    public async Task<JsonElement> CreateCallAsync(
        string phone,
        string task,
        string region,
        string locale,
        string idempotencyKey,
        string? webhookUrl,
        IDictionary<string, string>? metadata,
        CancellationToken ct = default)
    {
        var payload = new Dictionary<string, object?>
        {
            ["task"] = task,
            ["recipients"] = new[]
            {
                new Dictionary<string, object?>
                {
                    ["phones"] = new[] { phone },
                    ["region"] = region,
                    ["locale"] = locale
                }
            },
            ["recipient_result_schema"] = RecipientResultSchema
        };

        if (!string.IsNullOrWhiteSpace(webhookUrl)) payload["webhook_url"] = webhookUrl;
        if (metadata is { Count: > 0 }) payload["metadata"] = metadata;

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/calls")
        {
            Content = JsonContent.Create(payload)
        };
        request.Headers.Add("Idempotency-Key", idempotencyKey);
        SetAuthorization(request);

        using var response = await http.SendAsync(request, ct);
        return await ReadAsync(response, ct);
    }

    /// <summary>GET /v1/calls/{id}: status, summary, transcript and structured data.</summary>
    public async Task<JsonElement> GetCallAsync(string callId, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/v1/calls/{Uri.EscapeDataString(callId)}");
        SetAuthorization(request);
        using var response = await http.SendAsync(request, ct);
        return await ReadAsync(response, ct);
    }

    private void SetAuthorization(HttpRequestMessage request)
    {
        var apiKey = options.ApiKey;
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException("Configure the CALL-E API key in Settings before calling.");

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response, CancellationToken ct)
    {
        var body = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"CALL-E {(int)response.StatusCode}: {body}");

        return string.IsNullOrWhiteSpace(body)
            ? default
            : JsonSerializer.Deserialize<JsonElement>(body);
    }

    /// <summary>
    /// We ask CALL-E to structure the clinical information during the call.
    /// This is a complement, not a substitute: the risk classification is always
    /// decided by our model with consistent criteria.
    /// </summary>
    private static readonly object RecipientResultSchema = new Dictionary<string, object?>
    {
        ["type"] = "object",
        ["required"] = new[] { "reached_patient" },
        ["properties"] = new Dictionary<string, object?>
        {
            ["reached_patient"] = new Dictionary<string, object?>
            {
                ["type"] = "string",
                ["enum"] = new[] { "yes", "no", "unknown" },
                ["description"] = "Whether the patient personally answered the call."
            },
            ["reported_symptoms"] = new Dictionary<string, object?>
            {
                ["type"] = "array",
                ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                ["description"] = "Symptoms the patient reported, in their own words."
            },
            ["feels_better"] = new Dictionary<string, object?>
            {
                ["type"] = "string",
                ["enum"] = new[] { "better", "same", "worse", "unknown" },
                ["description"] = "How the patient feels compared to hospital discharge."
            },
            ["taking_medication"] = new Dictionary<string, object?>
            {
                ["type"] = "string",
                ["enum"] = new[] { "yes", "no", "partially", "unknown" }
            },
            ["red_flags"] = new Dictionary<string, object?>
            {
                ["type"] = "array",
                ["items"] = new Dictionary<string, object?> { ["type"] = "string" },
                ["description"] = "Warning signs mentioned: chest pain, breathlessness, high fever, bleeding, confusion, fainting."
            }
        }
    };
}
