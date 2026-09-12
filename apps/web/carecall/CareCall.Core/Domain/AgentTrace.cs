namespace CareCall.Core.Domain;

/// <summary>Agents of the clinical pipeline. The order reflects the execution sequence.</summary>
public enum AgentKind
{
    /// <summary>Generates the personalized questions CALL-E asks during the call.</summary>
    QuestionPlanner = 0,

    /// <summary>Analyzes the historical series of assessments to detect trends.</summary>
    TrendAnalyst = 1,

    /// <summary>Extracts symptoms and classifies the risk of the current call.</summary>
    Analyst = 2,

    /// <summary>Safety reviewer: looks for underestimated risk.</summary>
    DevilsAdvocate = 3,

    /// <summary>Drafts the structured clinical note (SBAR).</summary>
    ClinicalHandoff = 4,

    /// <summary>Proposes when to make the next follow-up call.</summary>
    AdaptiveScheduler = 5
}

/// <summary>
/// Trace of an agent's intervention. Persisted so the AI's reasoning can be
/// audited and to feed the dashboard's "AI reasoning" panel.
/// </summary>
public class AgentTrace
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Analyzed call. The QuestionPlanner runs before the call: it can be null.</summary>
    public Guid? CallSessionId { get; set; }
    public CallSession? CallSession { get; set; }

    /// <summary>Patient, so the trace can be queried even without an associated session.</summary>
    public Guid PatientId { get; set; }
    public Patient? Patient { get; set; }

    public AgentKind Agent { get; set; }

    /// <summary>Readable summary of what the agent decided.</summary>
    public string Outcome { get; set; } = string.Empty;

    /// <summary>Natural-language justification, to show the clinician.</summary>
    public string Rationale { get; set; } = string.Empty;

    /// <summary>Raw JSON output from the agent, useful for debugging and auditing.</summary>
    public string RawJson { get; set; } = string.Empty;

    /// <summary>False if the agent failed and the pipeline continued with the fallback.</summary>
    public bool Succeeded { get; set; } = true;

    /// <summary>Latency of the LLM invocation. Helps justify the pipeline's cost.</summary>
    public int ElapsedMs { get; set; }

    public DateTime CreatedOn { get; set; } = DateTime.UtcNow;
}
