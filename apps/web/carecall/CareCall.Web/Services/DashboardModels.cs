using CareCall.Core.Domain;

namespace CareCall.Web.Services;

public record DashboardStats(
    int TotalPatients,
    int InFollowUp,
    int Escalated,
    int OpenAlerts,
    int CriticalAlerts,
    int CallsLast7Days,
    int PendingCalls);

public record PatientRow(
    Guid Id,
    string Name,
    int Age,
    string PhoneNumber,
    string Diagnosis,
    DateTime DischargeDate,
    RiskLevel RiskLevel,
    PatientStatus Status,
    DateTime? NextCall,
    DateTime? LastCall,
    int OpenAlerts);

public record CallRow(
    Guid Id,
    Guid PatientId,
    string PatientName,
    DateTime DateTime,
    TimeSpan Duration,
    CallOutcome Outcome,
    RiskLevel? Risk,
    bool Worsening,
    string? Summary);

public record AlertRow(
    Guid Id,
    Guid PatientId,
    string PatientName,
    AlertSeverity Severity,
    string Description,
    DateTime CreatedOn,
    bool Resolved);

public record RiskPoint(DateTime DateTime, RiskLevel Risk, bool Worsening);

public record CallDay(DateOnly Day, int Count);

public record MonitoringCall(
    Guid Id,
    Guid PatientId,
    string PatientName,
    string PhoneNumber,
    string Diagnosis,
    DateTime StartedOn,
    CallOutcome Outcome,
    bool Submitted,
    bool Assessed,
    RiskLevel? Risk,
    string? Summary,
    IReadOnlyList<AgentStepVm> Steps,
    string Transcript = "",
    bool Scheduled = false)
{
    public bool IsDue => Scheduled && StartedOn <= DateTime.UtcNow;
    public bool NeedsResult => !Scheduled && (Outcome == CallOutcome.Pending
        || (Outcome == CallOutcome.Completed && !Assessed));

    public string Status => Outcome switch
    {
        _ when Scheduled && IsDue => "Starting simulation",
        _ when Scheduled => "Scheduled",
        CallOutcome.Pending when !Submitted && Steps.Count > 0 => "Simulation prepared",
        CallOutcome.Pending => Submitted ? "Awaiting call result" : "Preparing / awaiting submission",
        CallOutcome.Completed when !Assessed => "Awaiting clinical assessment",
        CallOutcome.Completed => "Assessment available",
        CallOutcome.NoAnswer => "No answer",
        CallOutcome.Refused => "Call declined",
        _ => "Call failed"
    };
}

public record MonitoringSnapshot(
    DateTime UpdatedOn,
    bool SchedulerEnabled,
    bool Simulated,
    int AwaitingResults,
    int UnassessedCalls,
    int OpenAlerts,
    int CriticalAlerts,
    int InFollowUp,
    IReadOnlyList<MonitoringCall> Calls,
    IReadOnlyList<AlertRow> Alerts,
    IReadOnlyList<PatientRow> Patients,
    IReadOnlyList<CallDay> DailyCalls);

/// <summary>A highlighted finding from an agent's reasoning (chip in the panel).</summary>
public record AgentHighlight(string Label, string Value);

/// <summary>
/// A step of the agentic pipeline, already normalized for rendering.
/// The raw reasoning lives in AgentTraces; here only the presentable part.
/// </summary>
public record AgentStepVm(
    AgentKind Agent,
    string Title,
    string Icon,
    string Outcome,
    string Rationale,
    bool Succeeded,
    long ElapsedMs,
    DateTime CreatedOn,
    IReadOnlyList<AgentHighlight> Highlights,
    IReadOnlyList<string> Findings,
    string? SupportingQuote,
    bool RiskWasOverridden);

public record PatientDetailVm(
    Patient Patient,
    IReadOnlyList<CallSession> Calls,
    IReadOnlyList<AlertRow> Alerts,
    IReadOnlyList<RiskPoint> Evolution,
    IReadOnlyList<DateTime> ScheduledDates,
    IReadOnlyDictionary<Guid, IReadOnlyList<AgentStepVm>> Reasoning);
