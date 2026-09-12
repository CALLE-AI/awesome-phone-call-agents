namespace CareCall.Core.Services;

/// <summary>Configuration for the integration with the CALL-E REST API.</summary>
public class CallEOptions
{
    public string BaseUrl { get; set; } = "https://api.heycall-e.com";

    /// <summary>API key from user-secrets or the server's protected configuration.</summary>
    public string? ApiKey { get; set; }

    public string? DemoPhoneNumber { get; set; }

    /// <summary>Maximum number of available calls (hackathon quota).</summary>
    public int CallBudget { get; set; } = 60;

    /// <summary>If false, no real call is placed.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>When true, calls are recorded for the demo without contacting CALL-E.</summary>
    public bool SimulateCalls { get; set; } = true;

    /// <summary>HTTP request timeout.</summary>
    public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(60);

    /// <summary>Recipient's ISO country code (ES = Spain, +34).</summary>
    public string Region { get; set; } = "ES";

    /// <summary>Conversation locale (es-ES, en-US...).</summary>
    public string Locale { get; set; } = "es-ES";

    /// <summary>Public webhook URL. If empty, the fallback poller is used.</summary>
    public string? WebhookUrl { get; set; }

    /// <summary>Shared secret to validate the incoming webhook.</summary>
    public string? WebhookSecret { get; set; }

    /// <summary>Corporate proxy (optional).</summary>
    public string? Proxy { get; set; }

    /// <summary>Fallback polling when there is no public webhook.</summary>
    public bool PollerEnabled { get; set; } = true;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}
