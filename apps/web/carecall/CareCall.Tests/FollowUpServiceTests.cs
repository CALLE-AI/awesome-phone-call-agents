using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using CareCall.Core.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace CareCall.Tests;

public class FollowUpServiceTests
{
    private static CallEDbContext NewDb() =>
        new(new DbContextOptionsBuilder<CallEDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static FollowUpService NewService(CallEDbContext db) =>
        new(db, NullLogger<FollowUpService>.Instance);

    private static Patient SeedPatient(CallEDbContext db, DateTime discharge)
    {
        var p = new Patient
        {
            Name = "Manuel Test",
            PhoneNumber = "+34600000000",
            BirthDate = new DateOnly(1950, 1, 1),
            DischargeDate = discharge,
            Diagnosis = "Neumonia",
            Status = PatientStatus.InFollowUp
        };
        p.FollowUpPlan = new FollowUpPlan
        {
            PatientId = p.Id,
            Active = true,
            ScheduledDates = AlertRules.BuildSchedule(discharge)
        };
        db.Patients.Add(p);
        db.SaveChanges();
        return p;
    }

    [Fact]
    public async Task GetDueCallsAsync_ReturnsPatient_WhenScheduledDateElapsed()
    {
        using var db = NewDb();
        var discharge = new DateTime(2026, 1, 1);
        SeedPatient(db, discharge);

        var due = await NewService(db).GetDueCallsAsync(discharge.AddDays(2));

        Assert.Single(due);
    }

    [Fact]
    public async Task GetDueCallsAsync_ReturnsEmpty_WhenCallsAlreadyMade()
    {
        using var db = NewDb();
        var discharge = new DateTime(2026, 1, 1);
        var patient = SeedPatient(db, discharge);
        db.CallSessions.Add(new CallSession
        {
            PatientId = patient.Id,
            DateTime = discharge.AddDays(1),
            Outcome = CallOutcome.Completed
        });
        db.SaveChanges();

        var due = await NewService(db).GetDueCallsAsync(discharge.AddDays(2));

        Assert.Empty(due);
    }

    [Fact]
    public async Task RegisterAssessmentAsync_HighRisk_CreatesCriticalAlert_AndEscalates()
    {
        using var db = NewDb();
        var patient = SeedPatient(db, new DateTime(2026, 1, 1));
        var session = new CallSession { PatientId = patient.Id, DateTime = DateTime.UtcNow };
        db.CallSessions.Add(session);
        db.SaveChanges();

        await NewService(db).RegisterAssessmentAsync(session.Id, new SymptomAssessmentDto
        {
            Symptoms = ["fiebre", "disnea"],
            RiskClassification = RiskLevel.High,
            Summary = "Empeora"
        });

        var updated = await db.Patients.Include(p => p.Alerts).FirstAsync(p => p.Id == patient.Id);
        Assert.Equal(PatientStatus.Escalated, updated.Status);
        Assert.Equal(RiskLevel.High, updated.RiskLevel);
        Assert.Single(updated.Alerts, a => a.Severity == AlertSeverity.Critical);
        Assert.Equal(CallOutcome.Completed, db.CallSessions.First(c => c.Id == session.Id).Outcome);
    }

    [Fact]
    public async Task RegisterAssessmentAsync_LowRisk_DoesNotCreateAlert()
    {
        using var db = NewDb();
        var patient = SeedPatient(db, new DateTime(2026, 1, 1));
        var session = new CallSession { PatientId = patient.Id, DateTime = DateTime.UtcNow };
        db.CallSessions.Add(session);
        db.SaveChanges();

        await NewService(db).RegisterAssessmentAsync(session.Id, new SymptomAssessmentDto
        {
            RiskClassification = RiskLevel.Low,
            Summary = "Estable"
        });

        Assert.Empty(db.Alerts);
    }

    [Fact]
    public async Task RegisterAssessmentAsync_ClosesFollowUp_AfterAllScheduledCalls()
    {
        using var db = NewDb();
        var discharge = new DateTime(2026, 1, 1);
        var patient = SeedPatient(db, discharge);
        var svc = NewService(db);

        for (var i = 0; i < 3; i++)
        {
            var s = new CallSession { PatientId = patient.Id, DateTime = discharge.AddDays(i + 1) };
            db.CallSessions.Add(s);
            db.SaveChanges();
            await svc.RegisterAssessmentAsync(s.Id, new SymptomAssessmentDto
            {
                RiskClassification = RiskLevel.Low,
                Summary = "Estable"
            });
        }

        var updated = await db.Patients.Include(p => p.FollowUpPlan).FirstAsync(p => p.Id == patient.Id);
        Assert.Equal(PatientStatus.Completed, updated.Status);
        Assert.False(updated.FollowUpPlan!.Active);
    }

    [Fact]
    public async Task RegisterCallOutcomeAsync_TwoNoAnswers_CreatesSingleAlert()
    {
        using var db = NewDb();
        var patient = SeedPatient(db, new DateTime(2026, 1, 1));
        var svc = NewService(db);

        var s1 = new CallSession { PatientId = patient.Id, DateTime = new DateTime(2026, 1, 2) };
        var s2 = new CallSession { PatientId = patient.Id, DateTime = new DateTime(2026, 1, 4) };
        db.CallSessions.AddRange(s1, s2);
        db.SaveChanges();

        await svc.RegisterCallOutcomeAsync(s1.Id, CallOutcome.NoAnswer);
        await svc.RegisterCallOutcomeAsync(s2.Id, CallOutcome.NoAnswer);

        Assert.Single(db.Alerts);
    }

    [Fact]
    public async Task ResolveAlertAsync_MarksAlertResolved()
    {
        using var db = NewDb();
        var patient = SeedPatient(db, new DateTime(2026, 1, 1));
        var alert = new Alert { PatientId = patient.Id, Severity = AlertSeverity.Warning, Description = "x" };
        db.Alerts.Add(alert);
        db.SaveChanges();

        await NewService(db).ResolveAlertAsync(alert.Id);

        Assert.True(db.Alerts.First(a => a.Id == alert.Id).Resolved);
    }
}
