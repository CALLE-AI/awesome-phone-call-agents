using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using CareCall.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;

namespace CareCall.Core.Agents;

/// <summary>Result of invoking an agent, along with the trace for auditing.</summary>
public record AgentRun<T>(T? Value, string RawJson, int ElapsedMs, bool Succeeded);

/// <summary>
/// Infrastructure shared by all agents: one LLM invocation with typed JSON
/// output, defensive parsing and latency measurement.
/// No agent throws exceptions: the pipeline must never lose a call.
/// </summary>
public class AgentRunner(Kernel kernel, ILogger<AgentRunner> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    private static readonly OpenAIPromptExecutionSettings Settings = new()
    {
        // Temperatura baja: en clinica preferimos reproducibilidad a creatividad.
        Temperature = 0.1,
        MaxTokens = 900,
        ResponseFormat = "json_object"
    };

    public async Task<AgentRun<T>> RunAsync<T>(
        string agentName,
        string systemPrompt,
        string userPrompt,
        CancellationToken ct = default) where T : class
    {
        var sw = Stopwatch.StartNew();
        var raw = string.Empty;

        try
        {
            var chat = kernel.GetRequiredService<IChatCompletionService>();
            var history = new ChatHistory(systemPrompt);
            history.AddUserMessage(userPrompt);

            var response = await chat.GetChatMessageContentAsync(history, Settings, kernel, ct);
            raw = response.Content ?? string.Empty;
            sw.Stop();

            var json = AssessmentParser.ExtractJsonObject(raw);
            if (json is null)
            {
                logger.LogWarning("{Agent}: la respuesta no contenia JSON. Raw: {Raw}", agentName, raw);
                return new AgentRun<T>(null, raw, (int)sw.ElapsedMilliseconds, false);
            }

            var value = JsonSerializer.Deserialize<T>(json, JsonOptions);
            return value is null
                ? new AgentRun<T>(null, raw, (int)sw.ElapsedMilliseconds, false)
                : new AgentRun<T>(value, raw, (int)sw.ElapsedMilliseconds, true);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            sw.Stop();
            logger.LogError(ex, "{Agent} fallo; el pipeline continua sin su aportacion.", agentName);
            return new AgentRun<T>(null, raw, (int)sw.ElapsedMilliseconds, false);
        }
    }
}
