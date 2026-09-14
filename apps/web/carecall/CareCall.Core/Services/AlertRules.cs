using CareCall.Core.Abstractions;
using CareCall.Core.Domain;

namespace CareCall.Core.Services;

/// <summary>Result of evaluating the clinical rules after a call.</summary>
public record AlertDecision(bool CreateAlert, AlertSeverity Severity, string Description, PatientStatus NewStatus);

/// <summary>
/// Deterministic alert and worsening rules. Pure logic with no dependencies
/// so it can be tested in isolation.
/// </summary>
public static class AlertRules
{
    /// <summary>Number of consecutive unanswered calls that trigger an alert.</summary>
    public const int UnansweredCallsThreshold = 2;

    /// <summary>Evaluates a call's assessment against the patient's history.</summary>
    public static AlertDecision Evaluate(
        Patient patient,
        SymptomAssessmentDto assessment,
        RiskLevel? previousRisk)
    {
        var worsened = assessment.WorseningDetected
            || (previousRisk is not null && assessment.RiskClassification > previousRisk);

        if (assessment.RiskClassification == RiskLevel.High)
        {
            return new AlertDecision(
                true,
                AlertSeverity.Critical,
                $"High risk detected during follow-up of {patient.Name}. {assessment.Summary}".Trim(),
                PatientStatus.Escalated);
        }

        if (worsened)
        {
            return new AlertDecision(
                true,
                AlertSeverity.Warning,
                $"Worsening detected in {patient.Name}. {assessment.Summary}".Trim(),
                PatientStatus.InFollowUp);
        }

        return new AlertDecision(false, AlertSeverity.Info, string.Empty, PatientStatus.InFollowUp);
    }

    /// <summary>Alert for an unreachable patient after several consecutive unanswered calls.</summary>
    public static AlertDecision EvaluateUnanswered(Patient patient, IReadOnlyList<CallSession> orderedSessions)
    {
        var consecutive = 0;
        for (var i = orderedSessions.Count - 1; i >= 0; i--)
        {
            var outcome = orderedSessions[i].Outcome;
            if (outcome == CallOutcome.Pending) continue;
            if (outcome is CallOutcome.NoAnswer or CallOutcome.Failed) consecutive++;
            else break;
        }

        return consecutive >= UnansweredCallsThreshold
            ? new AlertDecision(
                true,
                AlertSeverity.Warning,
                $"{patient.Name} has not answered after {consecutive} call attempts.",
                PatientStatus.InFollowUp)
            : new AlertDecision(false, AlertSeverity.Info, string.Empty, patient.Status);
    }

    /// <summary>Standard follow-up dates: +1, +3 and +7 days from discharge.</summary>
    public static List<DateTime> BuildSchedule(DateTime dischargeDate) =>
    [
        dischargeDate.AddDays(1),
        dischargeDate.AddDays(3),
        dischargeDate.AddDays(7)
    ];

    /// <summary>How many calls should already have been made per the plan.</summary>
    public static int DueCallCount(IEnumerable<DateTime> scheduledDates, DateTime now) =>
        scheduledDates.Count(d => d <= now);
}
