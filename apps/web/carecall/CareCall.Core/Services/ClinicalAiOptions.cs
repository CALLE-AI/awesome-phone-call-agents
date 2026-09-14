namespace CareCall.Core.Services;

/// <summary>LLM provider configuration for Semantic Kernel.</summary>
public class ClinicalAiOptions
{
    /// <summary>"AzureOpenAI" or "OpenAI".</summary>
    public string Provider { get; set; } = "AzureOpenAI";

    /// <summary>Deployment name (Azure) or model name (OpenAI).</summary>
    public string Model { get; set; } = "gpt-4o-mini";

    /// <summary>Azure OpenAI only.</summary>
    public string? Endpoint { get; set; }

    public string? ApiKey { get; set; }

    /// <summary>Corporate proxy. Required to reach Azure OpenAI from the internal network.</summary>
    public string? Proxy { get; set; }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ApiKey) &&
        (!Provider.Equals("AzureOpenAI", StringComparison.OrdinalIgnoreCase) || !string.IsNullOrWhiteSpace(Endpoint));
}
