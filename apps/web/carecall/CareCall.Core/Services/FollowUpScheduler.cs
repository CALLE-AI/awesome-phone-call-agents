using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CareCall.Core.Services;

public class FollowUpSchedulerOptions
{
    /// <summary>Interval between scheduler checks.</summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>Disables actually placing calls (useful in a demo).</summary>
    public bool Enabled { get; set; } = true;
}

/// <summary>
/// Periodically checks follow-up plans and triggers overdue calls.
/// </summary>
public class FollowUpScheduler(
    IServiceScopeFactory scopeFactory,
    FollowUpSchedulerOptions options,
    ILogger<FollowUpScheduler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(options.Interval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (options.Enabled)
                    await ProcessDueCallsAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error en el planificador de seguimiento.");
            }

            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }

    private async Task ProcessDueCallsAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var sp = scope.ServiceProvider;

        var followUp = sp.GetRequiredService<IFollowUpService>();
        var callE = sp.GetService<ICallEService>();
        var db = sp.GetRequiredService<CallEDbContext>();

        if (callE is null)
        {
            logger.LogDebug("ICallEService not registered; the scheduler will not place calls.");
            return;
        }

        var due = await followUp.GetDueCallsAsync(DateTime.UtcNow, ct);
        if (due.Count == 0) return;

        logger.LogInformation("{Count} patients with a pending call.", due.Count);

        foreach (var patient in due)
        {
            if (!options.Enabled) break;

            var callNumber = patient.CallSessions.Count + 1;

            var previousSummary = await db.SymptomAssessments
                .Where(a => a.CallSession!.PatientId == patient.Id)
                .OrderByDescending(a => a.CreatedOn)
                .Select(a => a.Summary)
                .FirstOrDefaultAsync(ct);

            var context = new FollowUpContext(
                patient.Name,
                patient.Diagnosis,
                patient.DischargeDate,
                callNumber,
                previousSummary);

            try
            {
                await callE.StartCallAsync(patient, context, ct);
                logger.LogInformation("Call {Number} started for {Patient}.", callNumber, patient.Name);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Could not start the call for {PatientId}.", patient.Id);
            }
        }
    }
}
