namespace CareCall.Core.Domain;

public enum RiskLevel
{
    Low = 0,
    Medium = 1,
    High = 2
}

public enum PatientStatus
{
    Discharged = 0,
    InFollowUp = 1,
    Completed = 2,
    Escalated = 3
}

public enum CallOutcome
{
    Pending = 0,
    Completed = 1,
    NoAnswer = 2,
    Failed = 3,
    Refused = 4
}

public enum AlertSeverity
{
    Info = 0,
    Warning = 1,
    Critical = 2
}
