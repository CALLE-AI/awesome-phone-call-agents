using CareCall.Core.Abstractions;
using CareCall.Core.Domain;
using CareCall.Core.Services;

namespace CareCall.Tests;

public class AlertRulesTests
{
    private static Patient NewPatient() => new()
    {
        Name = "Paciente Test",
        PhoneNumber = "+34600000000",
        BirthDate = new DateOnly(1950, 1, 1),
        DischargeDate = new DateTime(2026, 1, 1),
        Diagnosis = "EPOC",
        RiskLevel = RiskLevel.Low,
        Status = PatientStatus.InFollowUp
    };

    private static SymptomAssessmentDto Dto(RiskLevel risk, bool worsening = false) => new()
    {
        Symptoms = ["disnea"],
        RiskClassification = risk,
        Summary = "Resumen",
        WorseningDetected = worsening
    };

    [Fact]
    public void HighRisk_CreatesCriticalAlert_AndEscalates()
    {
        var result = AlertRules.Evaluate(NewPatient(), Dto(RiskLevel.High), RiskLevel.Low);

        Assert.True(result.CreateAlert);
        Assert.Equal(AlertSeverity.Critical, result.Severity);
        Assert.Equal(PatientStatus.Escalated, result.NewStatus);
    }

    [Fact]
    public void ExplicitWorsening_CreatesWarningAlert()
    {
        var result = AlertRules.Evaluate(NewPatient(), Dto(RiskLevel.Low, worsening: true), RiskLevel.Low);

        Assert.True(result.CreateAlert);
        Assert.Equal(AlertSeverity.Warning, result.Severity);
    }

    [Fact]
    public void RiskEscalation_FromLowToMedium_CreatesWarningAlert()
    {
        var result = AlertRules.Evaluate(NewPatient(), Dto(RiskLevel.Medium), RiskLevel.Low);

        Assert.True(result.CreateAlert);
        Assert.Equal(AlertSeverity.Warning, result.Severity);
    }

    [Fact]
    public void StableLowRisk_DoesNotCreateAlert()
    {
        var result = AlertRules.Evaluate(NewPatient(), Dto(RiskLevel.Low), RiskLevel.Low);

        Assert.False(result.CreateAlert);
        Assert.Equal(PatientStatus.InFollowUp, result.NewStatus);
    }

    [Fact]
    public void RiskImprovement_DoesNotCreateAlert()
    {
        var result = AlertRules.Evaluate(NewPatient(), Dto(RiskLevel.Low), RiskLevel.Medium);

        Assert.False(result.CreateAlert);
    }

    [Fact]
    public void FirstCall_WithMediumRisk_DoesNotCreateAlert()
    {
        var result = AlertRules.Evaluate(NewPatient(), Dto(RiskLevel.Medium), previousRisk: null);

        Assert.False(result.CreateAlert);
    }

    [Fact]
    public void TwoConsecutiveUnansweredCalls_CreateAlert()
    {
        var patient = NewPatient();
        var sessions = new List<CallSession>
        {
            new() { DateTime = new DateTime(2026, 1, 2), Outcome = CallOutcome.Completed },
            new() { DateTime = new DateTime(2026, 1, 4), Outcome = CallOutcome.NoAnswer },
            new() { DateTime = new DateTime(2026, 1, 5), Outcome = CallOutcome.Failed }
        };

        var result = AlertRules.EvaluateUnanswered(patient, sessions);

        Assert.True(result.CreateAlert);
        Assert.Equal(AlertSeverity.Warning, result.Severity);
    }

    [Fact]
    public void SingleUnansweredCall_DoesNotCreateAlert()
    {
        var sessions = new List<CallSession>
        {
            new() { DateTime = new DateTime(2026, 1, 2), Outcome = CallOutcome.Completed },
            new() { DateTime = new DateTime(2026, 1, 4), Outcome = CallOutcome.NoAnswer }
        };

        Assert.False(AlertRules.EvaluateUnanswered(NewPatient(), sessions).CreateAlert);
    }

    [Fact]
    public void BuildSchedule_Creates_Day1_Day3_Day7()
    {
        var discharge = new DateTime(2026, 1, 1, 10, 0, 0);

        var schedule = AlertRules.BuildSchedule(discharge);

        Assert.Equal(3, schedule.Count);
        Assert.Equal(discharge.AddDays(1), schedule[0]);
        Assert.Equal(discharge.AddDays(3), schedule[1]);
        Assert.Equal(discharge.AddDays(7), schedule[2]);
    }

    [Fact]
    public void DueCallCount_CountsOnlyElapsedDates()
    {
        var discharge = new DateTime(2026, 1, 1);
        var schedule = AlertRules.BuildSchedule(discharge);

        Assert.Equal(0, AlertRules.DueCallCount(schedule, discharge));
        Assert.Equal(1, AlertRules.DueCallCount(schedule, discharge.AddDays(1)));
        Assert.Equal(2, AlertRules.DueCallCount(schedule, discharge.AddDays(4)));
        Assert.Equal(3, AlertRules.DueCallCount(schedule, discharge.AddDays(10)));
    }
}
