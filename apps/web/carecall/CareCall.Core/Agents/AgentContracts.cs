using CareCall.Core.Domain;

namespace CareCall.Core.Agents;

// ---------------------------------------------------------------------------
// Input context
// ---------------------------------------------------------------------------

/// <summary>A previous already-assessed call, in chronological order.</summary>
public record HistoryEntry(
    DateTime When,
    CallOutcome Outcome,
    RiskLevel Risk,
    bool WorseningDetected,
    IReadOnlyList<string> Symptoms,
    string Summary);

/// <summary>Everything the agents need to know about the patient and their follow-up.</summary>
public record AgentContext(
    Patient Patient,
    IReadOnlyList<HistoryEntry> History,
    string? Transcript = null,
    string? ProviderSummary = null)
{
    public HistoryEntry? Previous => History.Count > 0 ? History[^1] : null;

    /// <summary>Number of the call about to be made or just made.</summary>
    public int CallNumber => History.Count + 1;
}

// ---------------------------------------------------------------------------
// Typed outputs, one per agent
// ---------------------------------------------------------------------------

/// <summary>Personalized questions for the next call.</summary>
public class QuestionPlanDto
{
    /// <summary>Specific questions, in order of clinical priority.</summary>
    public List<string> Questions { get; set; } = [];

    /// <summary>Open points from the previous call that need to be reconfirmed.</summary>
    public List<string> FollowUpPoints { get; set; } = [];

    /// <summary>Warning signs to watch for based on the diagnosis.</summary>
    public List<string> RedFlags { get; set; } = [];

    public string Rationale { get; set; } = string.Empty;
}

/// <summary>Longitudinal evolution of the patient across all calls.</summary>
public class TrendAnalysisDto
{
    /// <summary>"Improving" | "Stable" | "Worsening" | "Unknown".</summary>
    public string Trajectory { get; set; } = "Unknown";

    /// <summary>Symptoms that worsen consistently between calls.</summary>
    public List<string> ProgressiveFindings { get; set; } = [];

    /// <summary>True if the series reveals a deterioration that an isolated call does not show.</summary>
    public bool GradualDeteriorationDetected { get; set; }

    public string Rationale { get; set; } = string.Empty;
}

/// <summary>Objection from the safety reviewer about an assessment.</summary>
public class ChallengeDto
{
    public bool ChallengeFound { get; set; }

    /// <summary>Proposed risk. Only applied if the literal quote is verified.</summary>
    public RiskLevel? OverriddenRisk { get; set; }

    /// <summary>
    /// LITERAL patient quote justifying the objection. It is validated against the
    /// transcript: without a verifiable quote the objection does not alter the risk.
    /// </summary>
    public string? SupportingQuote { get; set; }

    public List<string> MissedFindings { get; set; } = [];

    public string Rationale { get; set; } = string.Empty;

    /// <summary>Filled in by the code, not the model: the quote exists in the transcript.</summary>
    public bool QuoteVerified { get; set; }
}

/// <summary>Structured SBAR clinical note for the healthcare professional.</summary>
public class HandoffNoteDto
{
    public string Situation { get; set; } = string.Empty;
    public string Background { get; set; } = string.Empty;
    public string Assessment { get; set; } = string.Empty;
    public string Recommendation { get; set; } = string.Empty;
}

/// <summary>Proposal for the next follow-up call.</summary>
public class SchedulingProposalDto
{
    /// <summary>Days until the next call. The 24h floor is enforced in code.</summary>
    public int NextCallInDays { get; set; } = 3;

    /// <summary>True if the follow-up can be considered finished.</summary>
    public bool DischargeFollowUp { get; set; }

    public string Rationale { get; set; } = string.Empty;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/// <summary>Generates the questions CALL-E drives during the call.</summary>
public interface IQuestionPlannerAgent
{
    Task<AgentRun<QuestionPlanDto>> PlanAsync(AgentContext context, CancellationToken ct = default);
}

/// <summary>Analyzes the historical series to detect progressive deterioration.</summary>
public interface ITrendAnalystAgent
{
    Task<AgentRun<TrendAnalysisDto>> AnalyzeAsync(AgentContext context, CancellationToken ct = default);
}

/// <summary>Safety reviewer: looks for underestimated risk. Never lowers it.</summary>
public interface IDevilsAdvocateAgent
{
    Task<AgentRun<ChallengeDto>> ChallengeAsync(
        AgentContext context,
        Abstractions.SymptomAssessmentDto assessment,
        CancellationToken ct = default);
}

/// <summary>Drafts the SBAR note for the healthcare professional.</summary>
public interface IClinicalHandoffAgent
{
    Task<AgentRun<HandoffNoteDto>> WriteAsync(
        AgentContext context,
        Abstractions.SymptomAssessmentDto assessment,
        CancellationToken ct = default);
}

/// <summary>Proposes when to call back based on the evolution.</summary>
public interface IAdaptiveSchedulerAgent
{
    Task<AgentRun<SchedulingProposalDto>> ProposeAsync(
        AgentContext context,
        Abstractions.SymptomAssessmentDto assessment,
        CancellationToken ct = default);
}
