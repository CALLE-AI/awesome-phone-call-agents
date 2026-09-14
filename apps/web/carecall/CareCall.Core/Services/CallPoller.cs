using System.Text;
using System.Text.Json;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CareCall.Core.Services;

public class CallPollerOptions
{
    public TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(20);
    public bool Enabled { get; set; } = true;

    /// <summary>After this time, a pending call is considered failed.</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromMinutes(15);
}

/// <summary>
/// CALL-E does not send webhooks: each call's status must be polled.
/// This service polls pending sessions and, once completed, triggers ingestion.
/// </summary>
public class CallPoller(
    IServiceScopeFactory scopeFactory,
    CallPollerOptions options,
    ILogger<CallPoller> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(options.Interval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (options.Enabled)
                    await PollAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error al sondear llamadas de CALL-E.");
            }

            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }

    private async Task PollAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var sp = scope.ServiceProvider;

        var db = sp.GetRequiredService<CallEDbContext>();
        var api = sp.GetRequiredService<CallEApiClient>();
        var ingestion = sp.GetRequiredService<CallIngestionService>();

        var pending = await db.CallSessions
            .Where(c => c.Outcome == CallOutcome.Pending && c.ExternalCallId != null)
            .ToListAsync(ct);

        foreach (var session in pending)
        {
            if (DateTime.UtcNow - session.DateTime > options.Timeout)
            {
                logger.LogWarning("Call {Id} expired after {Timeout}.", session.Id, options.Timeout);
                session.Outcome = CallOutcome.Failed;
                await db.SaveChangesAsync(ct);
                continue;
            }

            try
            {
                var status = await api.GetCallAsync(session.ExternalCallId!, ct);
                var state = CallStatusReader.ReadState(status);

                if (!CallStatusReader.IsTerminal(state)) continue;

                var payload = new CallCompletedPayload(
                    ExternalCallId: session.ExternalCallId,
                    CallSessionId: session.Id,
                    Transcript: CallStatusReader.ReadTranscript(status),
                    DurationSeconds: CallStatusReader.ReadDuration(status),
                    Status: state,
                    ProviderSummary: CallStatusReader.ReadSummary(status),
                    Evidence: CallStatusReader.ReadEvidence(status));

                await ingestion.IngestAsync(payload, ct);
                logger.LogInformation("Call {Id} processed with state {State}.", session.Id, state);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "No se pudo consultar la llamada {ExternalId}.", session.ExternalCallId);
            }
        }
    }
}