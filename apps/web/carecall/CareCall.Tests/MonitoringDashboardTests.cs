using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using CareCall.Web.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace CareCall.Tests;

public class MonitoringDashboardTests
{
    [Theory]
    [InlineData(CallOutcome.Pending, false, false, "Preparing / awaiting submission", true)]
    [InlineData(CallOutcome.Pending, true, false, "Awaiting call result", true)]
    [InlineData(CallOutcome.Completed, true, false, "Awaiting clinical assessment", true)]
    [InlineData(CallOutcome.Completed, true, true, "Assessment available", false)]
    [InlineData(CallOutcome.Failed, false, false, "Call failed", false)]
    public void CallStatus_DoesNotInventConnectionOrAnalysisProgress(
        CallOutcome outcome, bool submitted, bool assessed, string expected, bool needsResult)
    {
        var call = new MonitoringCall(Guid.NewGuid(), Guid.NewGuid(), "Demo patient", "", "",
            DateTime.UtcNow, outcome, submitted, assessed, null, null, []);

        Assert.Equal(expected, call.Status);
        Assert.Equal(needsResult, call.NeedsResult);
    }

    [Fact]
    public async Task Snapshot_PrioritizesCriticalAlerts_AndIncludesPendingCallsBeyondRecentHistory()
    {
        var factory = new TestFactory();
        var now = DateTime.UtcNow;
        var patient = new Patient { Name = "Demo patient", BirthDate = new DateOnly(1960, 1, 1), Status = PatientStatus.InFollowUp };
        var pending = new CallSession { PatientId = patient.Id, Outcome = CallOutcome.Pending, DateTime = now.AddDays(-9) };
        var pinned = new CallSession { PatientId = patient.Id, Outcome = CallOutcome.Failed, DateTime = now.AddDays(-10) };
        await using (var db = factory.CreateDbContext())
        {
            db.Patients.Add(patient);
            db.CallSessions.AddRange(pending, pinned);
            for (var i = 0; i < 15; i++)
                db.CallSessions.Add(new CallSession { PatientId = patient.Id, Outcome = CallOutcome.Failed, DateTime = now.AddMinutes(-i - 1) });
            db.Alerts.AddRange(
                new Alert { PatientId = patient.Id, Severity = AlertSeverity.Warning, CreatedOn = now },
                new Alert { PatientId = patient.Id, Severity = AlertSeverity.Critical, CreatedOn = now.AddDays(-1) },
                new Alert { PatientId = patient.Id, Severity = AlertSeverity.Critical, Resolved = true, CreatedOn = now });
            db.AgentTraces.Add(new AgentTrace { PatientId = patient.Id, CallSessionId = pending.Id, Agent = AgentKind.QuestionPlanner, Outcome = "Questions ready" });
            await db.SaveChangesAsync();
        }
        var settings = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["FollowUp:SchedulerEnabled"] = "false",
            ["CallE:SimulateCalls"] = "true"
        }).Build();
        var service = new DashboardService(factory, new NoCallsAllowed(), settings);

        var snapshot = await service.GetMonitoringAsync(pinned.Id);

        Assert.Equal(pending.Id, snapshot.Calls[0].Id);
        Assert.Contains(snapshot.Calls, c => c.Id == pinned.Id);
        Assert.Single(snapshot.Calls[0].Steps);
        Assert.Equal(1, snapshot.AwaitingResults);
        Assert.Equal(2, snapshot.OpenAlerts);
        Assert.Equal(1, snapshot.CriticalAlerts);
        Assert.Equal(AlertSeverity.Critical, snapshot.Alerts[0].Severity);
        Assert.False(snapshot.SchedulerEnabled);
        Assert.True(snapshot.Simulated);
        Assert.Equal(7, snapshot.DailyCalls.Count);
        Assert.Equal(15, snapshot.DailyCalls.Sum(d => d.Count));
        await using var verification = factory.CreateDbContext();
        Assert.Equal(17, await verification.CallSessions.CountAsync());
    }

    [Fact]
    public async Task Snapshot_KeepsEachTranscriptWithItsSession_AndReturnsEmptyForPendingCalls()
    {
        var factory = new TestFactory();
        var patient = new Patient { Name = "Demo patient", BirthDate = new DateOnly(1960, 1, 1) };
        const string transcript = "CALL-E: How are you?\nPatient: Better today.";
        var completed = new CallSession { PatientId = patient.Id, Outcome = CallOutcome.Completed, Transcript = transcript, DateTime = DateTime.UtcNow };
        var pending = new CallSession { PatientId = patient.Id, Outcome = CallOutcome.Pending, DateTime = DateTime.UtcNow };
        await using (var db = factory.CreateDbContext())
        {
            db.Patients.Add(patient);
            db.CallSessions.AddRange(completed, pending);
            await db.SaveChangesAsync();
        }

        var service = new DashboardService(factory, new NoCallsAllowed(), new ConfigurationBuilder().Build());
        var snapshot = await service.GetMonitoringAsync(completed.Id);

        Assert.Equal(transcript, snapshot.Calls.Single(c => c.Id == completed.Id).Transcript);
        Assert.Empty(snapshot.Calls.Single(c => c.Id == pending.Id).Transcript);
    }

    [Fact]
    public async Task EmptySnapshot_HasSevenZeroDays_AndNoInventedActivity()
    {
        var service = new DashboardService(new TestFactory(), new NoCallsAllowed(), new ConfigurationBuilder().Build());
        var snapshot = await service.GetMonitoringAsync();
        Assert.Empty(snapshot.Calls);
        Assert.Empty(snapshot.Alerts);
        Assert.Empty(snapshot.Patients);
        Assert.Equal(7, snapshot.DailyCalls.Count);
        Assert.All(snapshot.DailyCalls, day => Assert.Equal(0, day.Count));
    }

    private sealed class TestFactory : IDbContextFactory<CallEDbContext>
    {
        private readonly DbContextOptions<CallEDbContext> _options = new DbContextOptionsBuilder<CallEDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        public CallEDbContext CreateDbContext() => new(_options);
    }

    private sealed class NoCallsAllowed : ICallEService
    {
        public Task<CallSession> StartCallAsync(Patient patient, FollowUpContext context, CancellationToken ct = default) =>
            throw new InvalidOperationException("Monitoring must never initiate a call.");
    }
}
