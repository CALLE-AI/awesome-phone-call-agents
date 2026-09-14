using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using CareCall.Core.Services;
using CareCall.Web.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using System.Security.Cryptography;

namespace CareCall.Tests;

public class PatientSafetyTests
{
    [Fact]
    public async Task CreateAsync_RejectsDuplicatePhoneNumber()
    {
        await using var db = NewDb();
        var service = new PatientService(db);
        var input = new PatientInput("First", "+12025550123", new DateOnly(1980, 1, 1), DateTime.UtcNow, "Test", RiskLevel.Low);
        await service.CreateAsync(input);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(input));

        Assert.Equal("A patient with this phone number already exists.", error.Message);
    }

    [Fact]
    public async Task ResolveAlertAsync_RequiresJudgePassword()
    {
        var factory = new TestFactory();
        Guid alertId;
        await using (var db = factory.CreateDbContext())
        {
            var patient = new Patient { Name = "Test", PhoneNumber = "+12025550123" };
            var alert = new Alert { PatientId = patient.Id, Description = "Test alert" };
            db.AddRange(patient, alert);
            await db.SaveChangesAsync();
            alertId = alert.Id;
        }
        var dashboard = new DashboardService(factory, null!, new ConfigurationBuilder().Build(), judgeAccess: NewJudgeAccess());

        await Assert.ThrowsAsync<InvalidOperationException>(() => dashboard.ResolveAlertAsync(alertId, "wrong"));
        await dashboard.ResolveAlertAsync(alertId, "test-password");

        await using var verification = factory.CreateDbContext();
        Assert.True((await verification.Alerts.SingleAsync(a => a.Id == alertId)).Resolved);
    }

    [Fact]
    public async Task CancelFollowUpAsync_DeactivatesPlan_AndRetainsPatient()
    {
        var factory = new TestFactory();
        Guid patientId;
        await using (var db = factory.CreateDbContext())
        {
            var patient = new Patient { Name = "Test", PhoneNumber = "+12025550123", Status = PatientStatus.InFollowUp };
            patient.FollowUpPlan = new FollowUpPlan { PatientId = patient.Id, Active = true, ScheduledDates = [DateTime.UtcNow.AddDays(1)] };
            db.Patients.Add(patient);
            await db.SaveChangesAsync();
            patientId = patient.Id;
        }
        var dashboard = new DashboardService(factory, null!, new ConfigurationBuilder().Build(), judgeAccess: NewJudgeAccess());

        await dashboard.CancelFollowUpAsync(patientId, "test-password");

        await using var verification = factory.CreateDbContext();
        var savedPatient = await verification.Patients.Include(p => p.FollowUpPlan).SingleAsync(p => p.Id == patientId);
        Assert.False(savedPatient.FollowUpPlan!.Active);
        Assert.Equal(PatientStatus.Discharged, savedPatient.Status);
    }

    private static CallEDbContext NewDb() => new(new DbContextOptionsBuilder<CallEDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static IJudgeAccess NewJudgeAccess()
    {
        var salt = Enumerable.Range(1, 16).Select(i => (byte)i).ToArray();
        var hash = Rfc2898DeriveBytes.Pbkdf2("test-password", salt, 100_000, HashAlgorithmName.SHA256, 32);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["JudgeAccess:PasswordHash"] = $"100000:{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}"
        }).Build();
        return new JudgeAccessService(configuration);
    }

    private sealed class TestFactory : IDbContextFactory<CallEDbContext>
    {
        private readonly DbContextOptions<CallEDbContext> _options = new DbContextOptionsBuilder<CallEDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        public CallEDbContext CreateDbContext() => new(_options);
    }
}
