using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using CareCall.Core.Services;
using CareCall.Web.Components.Layout;
using CareCall.Web.Components.Shared;
using CareCall.Web.Services;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.JSInterop;

namespace CareCall.Tests;

public class DemoSettingsServiceTests : IDisposable
{
    private const string TestKey = "test-calle-key-not-a-real-credential";
    private const string DemoPhone = "+34600000000";
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private readonly DirectoryInfo _keyDirectory = new(Path.Combine(Path.GetTempPath(), "CareCall.Tests", Guid.NewGuid().ToString()));
    private readonly TestClock _clock = new();
    private readonly CallEOptions _callOptions = new();
    private readonly FollowUpSchedulerOptions _schedulerOptions = new() { Enabled = false };
    private readonly TestDbFactory _factory;

    public DemoSettingsServiceTests()
    {
        _connection.Open();
        _factory = new TestDbFactory(new DbContextOptionsBuilder<CallEDbContext>().UseSqlite(_connection).Options);
        using var db = _factory.CreateDbContext();
        db.Database.EnsureCreated();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Initialize_WithoutSavedSettings_PreservesConfigurationDefault(bool enabled)
    {
        _schedulerOptions.Enabled = enabled;
        _callOptions.ApiKey = TestKey;
        var service = NewService();

        await service.InitializeAsync();

        Assert.Equal(enabled, _schedulerOptions.Enabled);
        Assert.Equal(TestKey, _callOptions.ApiKey);
        Assert.False(service.SetupCompleted);
    }

    [Fact]
    public async Task ConfigureTrial_ProtectsKey_AndPreservesExistingPatients()
    {
        var first = await SeedPatient("First", _clock.Now.AddDays(1));
        var second = await SeedPatient("Second", _clock.Now.AddDays(2), status: PatientStatus.Completed);
        var service = NewService();
        _callOptions.Enabled = false;
        _schedulerOptions.Enabled = true;

        await service.ConfigureTrialAsync(TestKey);

        using var db = _factory.CreateDbContext();
        var settings = await db.DemoSettings.SingleAsync();
        Assert.True(settings.SetupCompleted);
        Assert.DoesNotContain(TestKey, settings.ProtectedApiKey);
        Assert.Equal(TestKey, NewProtector().Unprotect(settings.ProtectedApiKey));
        Assert.Equal(first.PhoneNumber, (await db.Patients.SingleAsync(p => p.Id == first.Id)).PhoneNumber);
        Assert.Equal(second.PhoneNumber, (await db.Patients.SingleAsync(p => p.Id == second.Id)).PhoneNumber);
        Assert.Equal(first.FollowUpPlan!.ScheduledDates, (await db.FollowUpPlans.SingleAsync(p => p.PatientId == first.Id)).ScheduledDates);
        Assert.Equal(second.FollowUpPlan!.ScheduledDates, (await db.FollowUpPlans.SingleAsync(p => p.PatientId == second.Id)).ScheduledDates);
        Assert.False(_callOptions.Enabled);
        Assert.False(_schedulerOptions.Enabled);
        Assert.Null(_callOptions.DemoPhoneNumber);
        Assert.DoesNotContain(TestKey, JsonSerializer.Serialize(await service.GetAsync()));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Initialize_RestoresSavedSettings_OverConfigurationDefault(bool enabled)
    {
        await SeedPatient("First", _clock.Now.AddDays(1));
        await NewService().SaveAsync(Input(enabled));
        var callOptions = new CallEOptions();
        var schedulerOptions = new FollowUpSchedulerOptions { Enabled = !enabled };
        var restarted = NewService(callOptions, schedulerOptions);

        await restarted.InitializeAsync();

        Assert.True(restarted.SetupCompleted);
        Assert.Equal(TestKey, callOptions.ApiKey);
        Assert.Equal(DemoPhone, callOptions.DemoPhoneNumber);
        Assert.Equal(enabled, schedulerOptions.Enabled);
    }

    [Fact]
    public async Task Enable_UpdatesSelectedPlan_AndLeavesOtherOverduePatientsUnchanged()
    {
        var selected = await SeedPatient("Selected", _clock.Now.AddHours(-2));
        var other = await SeedPatient("Other", _clock.Now.AddHours(-1));
        var service = NewService();

        var schedule = await service.SaveAsync(Input(enabled: true));

        Assert.Equal(new DemoCallSchedule("Selected", _clock.Now.AddMinutes(1)), schedule);
        using var db = _factory.CreateDbContext();
        var selectedPlan = await db.FollowUpPlans.SingleAsync(p => p.PatientId == selected.Id);
        var otherPlan = await db.FollowUpPlans.SingleAsync(p => p.PatientId == other.Id);
        Assert.Equal(_clock.Now.AddMinutes(1), selectedPlan.ScheduledDates[0]);
        Assert.Equal(selected.FollowUpPlan!.ScheduledDates.Skip(1), selectedPlan.ScheduledDates.Skip(1));
        Assert.Equal(other.FollowUpPlan!.ScheduledDates, otherPlan.ScheduledDates);
        var followUp = new FollowUpService(db, NullLogger<FollowUpService>.Instance);
        var dueNow = await followUp.GetDueCallsAsync(_clock.Now);
        Assert.DoesNotContain(dueNow, p => p.Id == selected.Id);
        Assert.Contains(dueNow, p => p.Id == other.Id);
        Assert.Contains(await followUp.GetDueCallsAsync(_clock.Now.AddMinutes(1)), p => p.Id == selected.Id);
    }

    [Fact]
    public async Task Enable_SelectsNextRemainingCall_AndSkipsIneligiblePatients()
    {
        await SeedPatient("Completed", _clock.Now.AddDays(-7), status: PatientStatus.Completed);
        await SeedPatient("Inactive", _clock.Now.AddDays(-6), active: false);
        await SeedPatient("In progress", _clock.Now.AddDays(-5), outcome: CallOutcome.Pending);
        var selected = await SeedPatient("Selected", _clock.Now.AddDays(-4), outcome: CallOutcome.Completed);

        await NewService().SaveAsync(Input(enabled: true));

        using var db = _factory.CreateDbContext();
        var plan = await db.FollowUpPlans.SingleAsync(p => p.PatientId == selected.Id);
        Assert.Equal(selected.FollowUpPlan!.ScheduledDates[0], plan.ScheduledDates[0]);
        Assert.Equal(_clock.Now.AddMinutes(1), plan.ScheduledDates[1]);
    }

    [Fact]
    public async Task SaveWhileEnabled_DoesNotRestartCountdown_AndDisableKeepsSchedules()
    {
        var patient = await SeedPatient("First", _clock.Now.AddDays(1));
        var service = NewService();
        var original = await service.SaveAsync(Input(enabled: true));
        _clock.Now = _clock.Now.AddMinutes(10);

        Assert.Null(await service.SaveAsync(Input(enabled: true)));
        Assert.Null(await service.SaveAsync(Input(enabled: false)));
        Assert.False(_schedulerOptions.Enabled);
        using (var db = _factory.CreateDbContext())
            Assert.Equal(original!.CallAtUtc, (await db.FollowUpPlans.SingleAsync(p => p.PatientId == patient.Id)).ScheduledDates[0]);

        var rescheduled = await service.SaveAsync(Input(enabled: true));
        Assert.Equal(_clock.Now.AddMinutes(1), rescheduled!.CallAtUtc);
    }

    [Fact]
    public async Task Enable_WithoutEligiblePatients_DoesNotPersistPartialChanges()
    {
        await SeedPatient("Completed", _clock.Now.AddDays(-1), status: PatientStatus.Completed);

        await Assert.ThrowsAsync<ValidationException>(() => NewService().SaveAsync(Input(enabled: true)));

        using var db = _factory.CreateDbContext();
        Assert.Empty(await db.DemoSettings.ToListAsync());
        Assert.NotEqual(DemoPhone, (await db.Patients.SingleAsync()).PhoneNumber);
        Assert.False(_schedulerOptions.Enabled);
    }

    [Fact]
    public async Task Save_BlankKeyKeepsExistingKey_AndReplacementSurvivesRestart()
    {
        var service = NewService();
        await service.SaveAsync(Input());
        var input = Input();
        input.NewApiKey = null;
        await service.SaveAsync(input);
        Assert.Equal(TestKey, _callOptions.ApiKey);

        input.NewApiKey = "replacement-test-key";
        await service.SaveAsync(input);
        var restoredOptions = new CallEOptions();
        await NewService(restoredOptions).InitializeAsync();
        Assert.Equal(input.NewApiKey, restoredOptions.ApiKey);
    }

    [Theory]
    [InlineData(null, "+34600000000", true)]
    [InlineData("test-key", "600000000", true)]
    [InlineData("test-key", "+34600000000", false)]
    [InlineData("key with spaces", "+34600000000", true)]
    public async Task Save_InvalidInputDoesNotCompleteSetup(string? key, string phone, bool consent)
    {
        var input = Input();
        input.NewApiKey = key;
        input.PhoneNumber = phone;
        input.ConfirmRealCalls = consent;
        var service = NewService();

        await Assert.ThrowsAsync<ValidationException>(() => service.SaveAsync(input));

        Assert.False(service.SetupCompleted);
        using var db = _factory.CreateDbContext();
        Assert.Empty(await db.DemoSettings.ToListAsync());
    }

    [Fact]
    public async Task Initialize_WithUnreadableKey_DisablesAutomaticCalls_AndAllowsRecovery()
    {
        using (var db = _factory.CreateDbContext())
        {
            db.DemoSettings.Add(new DemoSettings
            {
                SetupCompleted = true, AutomaticCallsEnabled = true,
                ProtectedApiKey = "invalid-protected-data", PhoneNumber = DemoPhone
            });
            await db.SaveChangesAsync();
        }
        _schedulerOptions.Enabled = true;
        var service = NewService();

        await service.InitializeAsync();

        Assert.False(service.SetupCompleted);
        Assert.False(_schedulerOptions.Enabled);
        Assert.NotNull((await service.GetAsync()).Warning);
        await service.SaveAsync(Input());
        Assert.True(service.SetupCompleted);
        Assert.Null((await service.GetAsync()).Warning);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Save_DoesNotChangeManualCallSimulation(bool simulate)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["CallE:SimulateCalls"] = simulate.ToString()
        }).Build();
        var dashboard = new DashboardService(_factory, null!, configuration);

        await NewService().SaveAsync(Input());

        Assert.Equal(simulate, dashboard.SimulateCalls);
    }

    [Fact]
    public async Task Migration_CreatesSettingsTable_AndMatchesCurrentModel()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        using var db = new CallEDbContext(new DbContextOptionsBuilder<CallEDbContext>().UseSqlite(connection).Options);

        await db.Database.MigrateAsync();

        Assert.False(db.Database.HasPendingModelChanges());
        Assert.Empty(await db.DemoSettings.ToListAsync());
        db.DemoSettings.Add(new DemoSettings { PhoneNumber = DemoPhone });
        await db.SaveChangesAsync();
        Assert.Equal(DemoPhone, (await db.DemoSettings.SingleAsync()).PhoneNumber);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Form_RendersRegistration_WithoutExposingConfiguredKey(bool liveTrial)
    {
        _callOptions.ApiKey = TestKey;
        _schedulerOptions.Enabled = false;
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(NewService());
        services.AddSingleton<NavigationManager>(new TestNavigationManager());
        await using var provider = services.BuildServiceProvider();
        await using var renderer = new HtmlRenderer(provider, provider.GetRequiredService<ILoggerFactory>());

        var html = await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var parameters = ParameterView.FromDictionary(new Dictionary<string, object?>
            {
                [nameof(DemoSettingsForm.LiveTrial)] = liveTrial
            });
            var output = await renderer.RenderComponentAsync<DemoSettingsForm>(parameters);
            return output.ToHtmlString();
        });

        Assert.Contains("Patient name", html);
        Assert.Contains("Phone number", html);
        Assert.Contains("Discharge diagnosis", html);
        Assert.Contains("Birth date", html);
        Assert.DoesNotContain("Judge password", html);
        Assert.Contains("<details", html);
        Assert.Equal(liveTrial, html.Contains("Call delay (minutes)", StringComparison.Ordinal));
        Assert.Equal(liveTrial, html.Contains("Register patient and call now", StringComparison.Ordinal));
        Assert.DoesNotContain("CALL-E API key", html);
        Assert.DoesNotContain("Saving replaces every existing", html);
        Assert.DoesNotContain("other overdue calls may start immediately", html);
        Assert.DoesNotContain(TestKey, html);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Form_ShowsCancelOnlyWhenHostedWithCallback(bool canCancel)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(NewService());
        await using var provider = services.BuildServiceProvider();
        await using var renderer = new HtmlRenderer(provider, provider.GetRequiredService<ILoggerFactory>());

        var html = await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var parameters = ParameterView.FromDictionary(new Dictionary<string, object?>
            {
                [nameof(DemoSettingsForm.OnCancel)] = canCancel
                    ? EventCallback.Factory.Create(this, () => { }) : default(EventCallback)
            });
            return (await renderer.RenderComponentAsync<DemoSettingsForm>(parameters)).ToHtmlString();
        });

        Assert.Equal(canCancel, html.Contains(">Cancel</button>", StringComparison.Ordinal));
        Assert.Contains("Call delay (minutes)", html);
        Assert.DoesNotContain("one minute after saving", html);
    }

    [Fact]
    public async Task Dialog_RendersLabelledNativeDialog_WithSharedForm()
    {
        _callOptions.ApiKey = TestKey;
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(NewService());
        services.AddSingleton<IJSRuntime>(new TestSessionStorage());
        await using var provider = services.BuildServiceProvider();
        await using var renderer = new HtmlRenderer(provider, provider.GetRequiredService<ILoggerFactory>());

        var html = await renderer.Dispatcher.InvokeAsync(async () =>
            (await renderer.RenderComponentAsync<DemoSettingsDialog>()).ToHtmlString());

        Assert.Contains("<dialog", html);
        Assert.Contains("aria-labelledby=\"demo-settings-title\"", html);
        Assert.Contains("id=\"demo-settings-title\"", html);
        Assert.Contains("Guided trial", html);
        Assert.Contains("aria-label=\"Close guided trial\"", html);
        Assert.Contains(">Cancel</button>", html);
        Assert.DoesNotContain("type=\"password\"", html);
        Assert.DoesNotContain(TestKey, html);
    }

    [Fact]
    public async Task SettingsRoute_RendersSharedForm_WithDashboardNavigation()
    {
        var navigation = new TestNavigationManager();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(NewService());
        services.AddSingleton<NavigationManager>(navigation);
        await using var provider = services.BuildServiceProvider();
        await using var renderer = new SettingsPageRenderer(provider, provider.GetRequiredService<ILoggerFactory>());

        var html = await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var output = renderer.BeginRenderingComponent(typeof(CareCall.Web.Components.Pages.Settings), ParameterView.Empty);
            await output.QuiescenceTask;
            return output.ToHtmlString();
        });

        Assert.Contains("<h1>Guided trial</h1>", html);
        Assert.Contains("Phone number", html);
        Assert.Contains(">Cancel</button>", html);
        Assert.Equal("settings", navigation.ToBaseRelativePath(navigation.Uri));
    }

    // Verify page markup without starting an interactive server circuit.
    private sealed class SettingsPageRenderer(IServiceProvider services, ILoggerFactory loggerFactory)
        : Microsoft.AspNetCore.Components.HtmlRendering.Infrastructure.StaticHtmlRenderer(services, loggerFactory)
    {
        protected override IComponent ResolveComponentForRenderMode(Type componentType, int? parentComponentId,
            IComponentActivator componentActivator, IComponentRenderMode renderMode) =>
            componentActivator.CreateInstance(componentType);
    }

    [Fact]
    public async Task Migration_PreservesExistingPatientsAndSchedules()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        using var db = new CallEDbContext(new DbContextOptionsBuilder<CallEDbContext>().UseSqlite(connection).Options);
        var previousMigration = db.Database.GetMigrations().Last(m => !m.EndsWith("_AddDemoSettings", StringComparison.Ordinal));
        await db.GetService<IMigrator>().MigrateAsync(previousMigration);
        var patient = new Patient { Name = "Existing patient", PhoneNumber = "+34999999999" };
        patient.FollowUpPlan = new FollowUpPlan
        {
            PatientId = patient.Id, Active = true, ScheduledDates = [_clock.Now.AddDays(1)]
        };
        db.Patients.Add(patient);
        await db.SaveChangesAsync();

        await db.Database.MigrateAsync();
        db.ChangeTracker.Clear();

        var restored = await db.Patients.Include(p => p.FollowUpPlan).SingleAsync();
        Assert.Equal(patient.Id, restored.Id);
        Assert.Equal(patient.PhoneNumber, restored.PhoneNumber);
        Assert.Equal(patient.FollowUpPlan.ScheduledDates, restored.FollowUpPlan!.ScheduledDates);
        Assert.Empty(await db.DemoSettings.ToListAsync());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Navigation_KeepsSettingsOutOfPrimaryMenu(bool completed)
    {
        var settings = NewService();
        if (completed) await settings.SaveAsync(Input());
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(settings);
        services.AddSingleton<NavigationManager>(new TestNavigationManager(""));
        services.AddSingleton<IJSRuntime>(new TestSessionStorage());
        await using var provider = services.BuildServiceProvider();
        await using var renderer = new HtmlRenderer(provider, provider.GetRequiredService<ILoggerFactory>());

        var html = await renderer.Dispatcher.InvokeAsync(async () =>
            (await renderer.RenderComponentAsync<NavMenu>()).ToHtmlString());

        Assert.DoesNotContain("aria-label=\"Setup incomplete\"", html);
        Assert.DoesNotContain("href=\"settings\"", html);
        Assert.Contains("aria-current=\"page\"", html);
        Assert.Contains("href=\"patients\"", html);
        Assert.Contains("href=\"calls\"", html);
        Assert.Contains("href=\"alerts\"", html);
    }

    [Theory]
    [InlineData("", false, "")]
    [InlineData("patients", false, "patients")]
    [InlineData("", true, "")]
    public async Task Navigation_FirstVisitStaysOnRequestedPage(string initialPath, bool storageBlocked, string expectedPath)
    {
        var navigation = new TestNavigationManager(initialPath);
        var capture = new NavMenuCapture();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(NewService());
        services.AddSingleton<NavigationManager>(navigation);
        services.AddSingleton<IJSRuntime>(new TestSessionStorage { Blocked = storageBlocked });
        services.AddSingleton(capture);
        await using var provider = services.BuildServiceProvider();
        await using var renderer = new HtmlRenderer(provider, provider.GetRequiredService<ILoggerFactory>());

        await renderer.Dispatcher.InvokeAsync(async () =>
        {
            await renderer.RenderComponentAsync<TestNavMenu>();
            await capture.Menu!.AfterRenderAsync();
            Assert.Equal(expectedPath, navigation.ToBaseRelativePath(navigation.Uri));

            navigation.NavigateTo("patients");
            await renderer.RenderComponentAsync<TestNavMenu>();
            await capture.Menu!.AfterRenderAsync();
            Assert.Equal("patients", navigation.ToBaseRelativePath(navigation.Uri));

            navigation.NavigateTo("");
            await renderer.RenderComponentAsync<TestNavMenu>();
            await capture.Menu!.AfterRenderAsync();
            Assert.Equal("", navigation.ToBaseRelativePath(navigation.Uri));
        });
    }

    private DemoSettingsService NewService(CallEOptions? callOptions = null, FollowUpSchedulerOptions? schedulerOptions = null) =>
        new(_factory, DataProtectionProvider.Create(_keyDirectory), callOptions ?? _callOptions,
            schedulerOptions ?? _schedulerOptions, _clock);

    private IDataProtector NewProtector() =>
        DataProtectionProvider.Create(_keyDirectory).CreateProtector("CallE.DemoSettings.ApiKey.v1");

    private static DemoSettingsInput Input(bool enabled = false) => new()
    {
        NewApiKey = TestKey, PhoneNumber = DemoPhone,
        AutomaticCallsEnabled = enabled, ConfirmRealCalls = true
    };

    private async Task<Patient> SeedPatient(string name, DateTime firstCall,
        PatientStatus status = PatientStatus.InFollowUp, bool active = true, CallOutcome? outcome = null)
    {
        var patient = new Patient
        {
            Name = name, PhoneNumber = "+34999999999", Status = status,
            BirthDate = new DateOnly(1960, 1, 1), DischargeDate = firstCall.AddDays(-1), Diagnosis = "Test diagnosis"
        };
        patient.FollowUpPlan = new FollowUpPlan
        {
            PatientId = patient.Id, Active = active,
            ScheduledDates = [firstCall, firstCall.AddDays(2), firstCall.AddDays(6)]
        };
        if (outcome is { } callOutcome)
            patient.CallSessions.Add(new CallSession { PatientId = patient.Id, Outcome = callOutcome, DateTime = firstCall });
        using var db = _factory.CreateDbContext();
        db.Patients.Add(patient);
        await db.SaveChangesAsync();
        return patient;
    }

    public void Dispose()
    {
        _connection.Dispose();
        if (_keyDirectory.Exists) _keyDirectory.Delete(recursive: true);
    }

    private sealed class TestDbFactory(DbContextOptions<CallEDbContext> options) : IDbContextFactory<CallEDbContext>
    {
        public CallEDbContext CreateDbContext() => new(options);
    }

    private sealed class TestClock : TimeProvider
    {
        public DateTime Now { get; set; } = new(2030, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        public override DateTimeOffset GetUtcNow() => new(Now);
    }

    private sealed class TestNavigationManager : NavigationManager
    {
        public TestNavigationManager(string path = "settings") => Initialize("https://example.invalid/", $"https://example.invalid/{path}");
        protected override void NavigateToCore(string uri, bool forceLoad) => Uri = ToAbsoluteUri(uri).ToString();
    }

    private sealed class NavMenuCapture
    {
        public TestNavMenu? Menu { get; set; }
    }

    private sealed class TestNavMenu : NavMenu
    {
        [Inject] public NavMenuCapture Capture { get; set; } = default!;
        protected override void OnInitialized() => Capture.Menu = this;
        public Task AfterRenderAsync() => base.OnAfterRenderAsync(firstRender: true);
    }

    private sealed class TestSessionStorage : IJSRuntime
    {
        private bool _visited;
        public bool Blocked { get; init; }

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) =>
            InvokeAsync<TValue>(identifier, CancellationToken.None, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            if (Blocked) throw new JSException("Storage is disabled.");
            if (identifier == "sessionStorage.getItem")
                return ValueTask.FromResult((TValue)(object?)(_visited ? "true" : null)!);
            if (identifier == "sessionStorage.setItem") _visited = true;
            return ValueTask.FromResult(default(TValue)!);
        }
    }
}
