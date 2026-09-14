using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using CareCall.Core.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace CareCall.Web.Services;

public class CallActivationInput
{
    [StringLength(4096)]
    [RegularExpression(@"^\S+$", ErrorMessage = "The API key cannot contain whitespace.")]
    public string? NewApiKey { get; set; }

    [Range(typeof(bool), "true", "true", ErrorMessage = "Confirm activation of real calls.")]
    public bool ConfirmRealCalls { get; set; }
}

public class DemoSettingsInput
{
    [StringLength(4096)]
    [RegularExpression(@"^\S+$", ErrorMessage = "The API key cannot contain whitespace.")]
    public string? NewApiKey { get; set; }

    [Required]
    [RegularExpression(@"^\+[1-9]\d{7,14}$", ErrorMessage = "Enter an international phone number, for example +34600000000.")]
    public string PhoneNumber { get; set; } = string.Empty;

    public bool AutomaticCallsEnabled { get; set; }
    public bool ConfirmRealCalls { get; set; }
}

public record DemoSettingsView(
    bool SetupCompleted,
    bool HasApiKey,
    string PhoneNumber,
    bool AutomaticCallsEnabled,
    string? Warning);

public record DemoCallSchedule(string PatientName, DateTime CallAtUtc);

public class DemoSettingsService(
    IDbContextFactory<CallEDbContext> factory,
    IDataProtectionProvider protection,
    CallEOptions callOptions,
    FollowUpSchedulerOptions schedulerOptions,
    TimeProvider clock)
{
    private readonly IDataProtector _protector = protection.CreateProtector("CallE.DemoSettings.ApiKey.v1");
    private readonly SemaphoreSlim _updateLock = new(1, 1);
    private volatile bool _setupCompleted;
    private string? _warning;

    public bool SetupCompleted => _setupCompleted;
    public bool RealCallsEnabled => !callOptions.SimulateCalls && callOptions.Enabled && callOptions.IsConfigured;
    public event Action? ModeChanged;

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await _updateLock.WaitAsync(ct);
        try
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var settings = await db.DemoSettings.AsNoTracking().SingleOrDefaultAsync(s => s.Id == 1, ct);
            if (settings is not { SetupCompleted: true }) return;

            try
            {
                var apiKey = _protector.Unprotect(settings.ProtectedApiKey);
                Apply(settings, apiKey);
            }
            catch (CryptographicException)
            {
                callOptions.ApiKey = null;
                schedulerOptions.Enabled = false;
                _warning = "The saved API key could not be decrypted. Enter it again to restore setup. Automatic calls are disabled.";
            }
        }
        finally
        {
            _updateLock.Release();
        }
    }

    public async Task EnableRealCallsAsync(CallActivationInput input, CancellationToken ct = default)
    {
        Validator.ValidateObject(input, new ValidationContext(input), validateAllProperties: true);
        if (!callOptions.Enabled)
            throw new ValidationException("Real calls are disabled by server configuration.");

        await _updateLock.WaitAsync(ct);
        try
        {
            var apiKey = string.IsNullOrEmpty(input.NewApiKey) ? callOptions.ApiKey : input.NewApiKey;
            if (string.IsNullOrWhiteSpace(apiKey))
                throw new ValidationException("A CALL-E API key is required to activate real calls.");

            await using var db = await factory.CreateDbContextAsync(ct);
            var settings = await db.DemoSettings.SingleOrDefaultAsync(s => s.Id == 1, ct) ?? new DemoSettings();
            if (db.Entry(settings).State == EntityState.Detached) db.DemoSettings.Add(settings);
            settings.ProtectedApiKey = _protector.Protect(apiKey);
            settings.SetupCompleted = true;
            await db.SaveChangesAsync(ct);

            callOptions.ApiKey = apiKey;
            callOptions.SimulateCalls = false;
            _setupCompleted = true;
            _warning = null;
        }
        finally
        {
            _updateLock.Release();
        }
        ModeChanged?.Invoke();
    }

    public Task DisableRealCallsAsync()
    {
        callOptions.SimulateCalls = true;
        ModeChanged?.Invoke();
        return Task.CompletedTask;
    }

    public async Task<DemoSettingsView> GetAsync(CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        var settings = await db.DemoSettings.AsNoTracking().SingleOrDefaultAsync(s => s.Id == 1, ct);

        return new DemoSettingsView(_setupCompleted, callOptions.IsConfigured,
            settings?.PhoneNumber ?? string.Empty, schedulerOptions.Enabled, _warning);
    }

    public async Task<DemoCallSchedule?> SaveAsync(DemoSettingsInput input, CancellationToken ct = default)
    {
        Validator.ValidateObject(input, new ValidationContext(input), validateAllProperties: true);
        if (!input.ConfirmRealCalls)
            throw new ValidationException("Confirm that you control this number and authorize real demo calls.");

        await _updateLock.WaitAsync(ct);
        try
        {
            var apiKey = string.IsNullOrEmpty(input.NewApiKey) ? callOptions.ApiKey : input.NewApiKey;
            if (string.IsNullOrWhiteSpace(apiKey))
                throw new ValidationException("A CALL-E API key is required to complete setup.");

            await using var db = await factory.CreateDbContextAsync(ct);
            var settings = await db.DemoSettings.SingleOrDefaultAsync(s => s.Id == 1, ct);
            if (settings is null)
            {
                settings = new DemoSettings();
                db.DemoSettings.Add(settings);
            }

            var patients = await db.Patients.Include(p => p.FollowUpPlan)
                .Include(p => p.CallSessions).ToListAsync(ct);
            DemoCallSchedule? scheduledCall = null;

            if (input.AutomaticCallsEnabled && !schedulerOptions.Enabled)
            {
                var patient = patients
                    .Where(p => p.FollowUpPlan is { Active: true }
                        && p.Status != PatientStatus.Completed
                        && !p.CallSessions.Any(c => c.Outcome == CallOutcome.Pending)
                        && p.CallSessions.Count < p.FollowUpPlan.ScheduledDates.Count)
                    .OrderBy(p => p.FollowUpPlan!.ScheduledDates.OrderBy(d => d).ElementAt(p.CallSessions.Count))
                    .ThenBy(p => p.Name).ThenBy(p => p.Id)
                    .FirstOrDefault()
                    ?? throw new ValidationException("No patient is eligible for an automatic call. An active plan with a remaining call and no call in progress is required. You can save with automatic calls disabled.");

                var firstCallAt = clock.GetUtcNow().UtcDateTime.AddMinutes(1);
                var dates = patient.FollowUpPlan!.ScheduledDates.OrderBy(d => d).ToList();
                var next = patient.CallSessions.Count;
                dates[next] = firstCallAt;
                for (var i = next + 1; i < dates.Count; i++)
                    if (dates[i] <= dates[i - 1]) dates[i] = dates[i - 1].AddDays(1);

                patient.FollowUpPlan.ScheduledDates = dates;
                scheduledCall = new DemoCallSchedule(patient.Name, firstCallAt);
            }

            foreach (var patient in patients)
                patient.PhoneNumber = input.PhoneNumber;

            settings.ProtectedApiKey = _protector.Protect(apiKey);
            settings.PhoneNumber = input.PhoneNumber;
            settings.AutomaticCallsEnabled = input.AutomaticCallsEnabled;
            settings.SetupCompleted = true;
            await db.SaveChangesAsync(ct);
            Apply(settings, apiKey);
            return scheduledCall;
        }
        finally
        {
            _updateLock.Release();
        }
    }

    public async Task ConfigureTrialAsync(string? newApiKey, CancellationToken ct = default)
    {
        await _updateLock.WaitAsync(ct);
        try
        {
            var apiKey = string.IsNullOrEmpty(newApiKey) ? callOptions.ApiKey : newApiKey;
            if (string.IsNullOrWhiteSpace(apiKey))
                throw new ValidationException("A CALL-E API key is required for a live trial.");

            await using var db = await factory.CreateDbContextAsync(ct);
            if (apiKey != callOptions.ApiKey && await db.CallSessions.AnyAsync(
                c => c.Outcome == CallOutcome.Pending && c.ExternalCallId != null, ct))
                throw new ValidationException("Wait for the current live calls to finish before changing the shared API key.");

            var settings = await db.DemoSettings.SingleOrDefaultAsync(s => s.Id == 1, ct);
            if (settings is null)
            {
                settings = new DemoSettings();
                db.DemoSettings.Add(settings);
            }

            settings.ProtectedApiKey = _protector.Protect(apiKey);
            settings.PhoneNumber = string.Empty;
            settings.AutomaticCallsEnabled = false;
            settings.SetupCompleted = true;
            await db.SaveChangesAsync(ct);
            Apply(settings, apiKey);
        }
        finally
        {
            _updateLock.Release();
        }
    }

    private void Apply(DemoSettings settings, string apiKey)
    {
        callOptions.ApiKey = apiKey;
        callOptions.DemoPhoneNumber = string.IsNullOrWhiteSpace(settings.PhoneNumber) ? null : settings.PhoneNumber;
        schedulerOptions.Enabled = settings.AutomaticCallsEnabled;
        _warning = null;
        _setupCompleted = true;
    }
}
