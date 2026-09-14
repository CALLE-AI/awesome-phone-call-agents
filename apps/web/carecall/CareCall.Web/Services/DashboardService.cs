using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using CareCall.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace CareCall.Web.Services;

/// <summary>
/// Dashboard read model. Queries EF Core directly:
/// the volume is small so we avoid unnecessary layers.
/// </summary>
public class DashboardService(
    IDbContextFactory<CallEDbContext> factory,
    ICallEService callE,
    IConfiguration configuration,
    FollowUpSchedulerOptions? schedulerOptions = null,
    CallEOptions? callOptions = null,
    IJudgeAccess? judgeAccess = null)
{
    public async Task<DashboardStats> GetStatsAsync(CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        var now = DateTime.UtcNow;
        var weekAgo = now.AddDays(-7);

        var patients = await db.Patients.AsNoTracking()
            .Include(p => p.FollowUpPlan)
            .ToListAsync(ct);

        var pendingCalls = patients
            .Where(p => p.FollowUpPlan is { Active: true })
            .Sum(p => p.FollowUpPlan!.ScheduledDates.Count(d => d > now));

        return new DashboardStats(
            TotalPatients: patients.Count,
            InFollowUp: patients.Count(p => p.Status == PatientStatus.InFollowUp),
            Escalated: patients.Count(p => p.Status == PatientStatus.Escalated),
            OpenAlerts: await db.Alerts.CountAsync(a => !a.Resolved, ct),
            CriticalAlerts: await db.Alerts.CountAsync(a => !a.Resolved && a.Severity == AlertSeverity.Critical, ct),
            CallsLast7Days: await db.CallSessions.CountAsync(c => c.DateTime >= weekAgo, ct),
            PendingCalls: pendingCalls);
    }

    public async Task<IReadOnlyList<PatientRow>> GetPatientsAsync(string? search = null, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        var now = DateTime.UtcNow;

        var query = db.Patients.AsNoTracking()
            .Include(p => p.FollowUpPlan)
            .Include(p => p.CallSessions)
            .Include(p => p.Alerts)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(p => EF.Functions.Like(p.Name, $"%{term}%")
                                  || EF.Functions.Like(p.Diagnosis, $"%{term}%"));
        }

        var patients = await query.ToListAsync(ct);

        return [.. patients
            .Select(p => new PatientRow(
                p.Id,
                p.Name,
                p.Age,
                p.PhoneNumber,
                p.Diagnosis,
                p.DischargeDate,
                p.RiskLevel,
                p.Status,
                p.FollowUpPlan is { Active: true }
                    ? p.FollowUpPlan.ScheduledDates.Where(d => d > now).OrderBy(d => d).Cast<DateTime?>().FirstOrDefault()
                    : null,
                p.CallSessions.Where(c => c.Outcome != CallOutcome.Pending)
                              .OrderByDescending(c => c.DateTime)
                              .Select(c => (DateTime?)c.DateTime).FirstOrDefault(),
                p.Alerts.Count(a => !a.Resolved)))
            .OrderByDescending(r => r.OpenAlerts)
            .ThenByDescending(r => r.RiskLevel)
            .ThenBy(r => r.Name)];
    }

    public async Task<PatientDetailVm?> GetPatientAsync(Guid id, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);

        var patient = await db.Patients.AsNoTracking()
            .Include(p => p.FollowUpPlan)
            .Include(p => p.CallSessions).ThenInclude(c => c.Assessment)
            .Include(p => p.Alerts)
            .FirstOrDefaultAsync(p => p.Id == id, ct);

        if (patient is null) return null;

        var calls = patient.CallSessions.OrderByDescending(c => c.DateTime).ToList();

        var alerts = patient.Alerts
            .OrderByDescending(a => a.CreatedOn)
            .Select(a => new AlertRow(a.Id, patient.Id, patient.Name, a.Severity, a.Description, a.CreatedOn, a.Resolved))
            .ToList();

        var evolution = calls
            .Where(c => c.Assessment is not null)
            .OrderBy(c => c.DateTime)
            .Select(c => new RiskPoint(c.DateTime, c.Assessment!.RiskClassification, c.Assessment.WorseningDetected))
            .ToList();

        var scheduled = patient.FollowUpPlan?.ScheduledDates.OrderBy(d => d).ToList() ?? [];

        // Agent reasoning, grouped by call so it can be rendered inline.
        var traces = await db.AgentTraces.AsNoTracking()
            .Where(t => t.PatientId == id && t.CallSessionId != null)
            .OrderBy(t => t.CreatedOn)
            .ToListAsync(ct);

        var reasoning = traces
            .GroupBy(t => t.CallSessionId!.Value)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<AgentStepVm>)[.. g.Select(AgentTracePresenter.ToViewModel)]);

        return new PatientDetailVm(patient, calls, alerts, evolution, scheduled, reasoning);
    }

    public async Task<IReadOnlyList<CallRow>> GetRecentCallsAsync(int take = 25, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);

        return await db.CallSessions.AsNoTracking()
            .Include(c => c.Patient)
            .Include(c => c.Assessment)
            .OrderByDescending(c => c.DateTime)
            .Take(take)
            .Select(c => new CallRow(
                c.Id,
                c.PatientId,
                c.Patient!.Name,
                c.DateTime,
                c.Duration,
                c.Outcome,
                c.Assessment != null ? c.Assessment.RiskClassification : null,
                c.Assessment != null && c.Assessment.WorseningDetected,
                c.Assessment != null ? c.Assessment.Summary : null))
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<AlertRow>> GetAlertsAsync(bool onlyOpen = true, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);

        var query = db.Alerts.AsNoTracking().Include(a => a.Patient).AsQueryable();
        if (onlyOpen) query = query.Where(a => !a.Resolved);

        return await query
            .OrderByDescending(a => a.Severity)
            .ThenByDescending(a => a.CreatedOn)
            .Select(a => new AlertRow(a.Id, a.PatientId, a.Patient!.Name, a.Severity, a.Description, a.CreatedOn, a.Resolved))
            .ToListAsync(ct);
    }

    /// <summary>Alert resolution from the dashboard (fallback if Dev A doesn't yet expose the service).</summary>
    public async Task ResolveAlertAsync(Guid alertId, string judgePassword, CancellationToken ct = default)
    {
        EnsureJudgeAccess(judgePassword);
        await using var db = await factory.CreateDbContextAsync(ct);
        var alert = await db.Alerts.FirstOrDefaultAsync(a => a.Id == alertId, ct);
        if (alert is null || alert.Resolved) return;

        alert.Resolved = true;
        await db.SaveChangesAsync(ct);
    }

    public async Task CancelFollowUpAsync(Guid patientId, string judgePassword, CancellationToken ct = default)
    {
        EnsureJudgeAccess(judgePassword);
        await using var db = await factory.CreateDbContextAsync(ct);
        var patient = await db.Patients.Include(p => p.FollowUpPlan).FirstOrDefaultAsync(p => p.Id == patientId, ct);
        if (patient?.FollowUpPlan is null) return;

        patient.FollowUpPlan.Active = false;
        patient.Status = PatientStatus.Discharged;
        await db.SaveChangesAsync(ct);
    }

    public async Task DeletePatientAsync(Guid patientId, string judgePassword, CancellationToken ct = default)
    {
        EnsureJudgeAccess(judgePassword);
        await using var db = await factory.CreateDbContextAsync(ct);
        var patient = await db.Patients.FirstOrDefaultAsync(p => p.Id == patientId, ct);
        if (patient is null) return;

        db.Patients.Remove(patient);
        await db.SaveChangesAsync(ct);
    }

    private void EnsureJudgeAccess(string password)
    {
        if (judgeAccess is null || !judgeAccess.IsAuthorized(password))
            throw new InvalidOperationException("Enter the judge password to perform this action.");
    }

    /// <summary>
    /// Triggers an on-demand follow-up call from the dashboard.
    /// Consumes real CALL-E quota: used in the live demo.
    /// </summary>
    public async Task<string> TriggerCallAsync(Guid patientId, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);

        var patient = await db.Patients
            .Include(p => p.FollowUpPlan)
            .FirstOrDefaultAsync(p => p.Id == patientId, ct);

        if (patient is null) return "Patient not found.";

        // Avoids starting a second call if one is already in progress.
        var inFlight = await db.CallSessions
            .AnyAsync(c => c.PatientId == patientId && c.Outcome == CallOutcome.Pending, ct);
        if (inFlight) return "There is already a call in progress for this patient.";

        var previous = await db.CallSessions
            .Where(c => c.PatientId == patientId)
            .OrderByDescending(c => c.DateTime)
            .Select(c => new { c.Id, c.DateTime })
            .ToListAsync(ct);

        var previousSummary = await db.SymptomAssessments
            .Where(a => previous.Select(p => p.Id).Contains(a.CallSessionId))
            .OrderByDescending(a => a.Id)
            .Select(a => a.Summary)
            .FirstOrDefaultAsync(ct);

        var context = new FollowUpContext(
            PatientName: patient.Name,
            Diagnosis: patient.Diagnosis,
            DischargeDate: patient.DischargeDate,
            CallNumber: previous.Count + 1,
            PreviousSummary: previousSummary);

        // Simulation follows the same planning, assessment and alert pipeline,
        // while CallEService guarantees the provider is never contacted.
        if (SimulateCalls)
        {
            await callE.StartCallAsync(patient, context, ct);
            return $"[Simulation] Follow-up completed for {patient.PhoneNumber}. The CALL-E provider was not contacted.";
        }

        try
        {
            await callE.StartCallAsync(patient, context, ct);
            return $"Call to {patient.PhoneNumber} started. The result will appear here once it finishes.";
        }
        catch (Exception ex)
        {
            return $"Could not start the call: {ex.Message}";
        }
    }

    /// <summary>
    /// If true, the telephony provider is not contacted (CallE:SimulateCalls).
    /// Enabled by default so the test line isn't consumed during the demo.
    /// </summary>
    public bool SimulateCalls => callOptions?.SimulateCalls ?? configuration.GetValue("CallE:SimulateCalls", true);

    public async Task<MonitoringSnapshot> GetMonitoringAsync(Guid? selectedCallId = null, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        var now = DateTime.UtcNow;
        var firstDay = now.Date.AddDays(-6);

        var awaiting = await db.CallSessions.CountAsync(c => c.Outcome == CallOutcome.Pending, ct);
        var unassessed = await db.CallSessions.CountAsync(c => c.Outcome == CallOutcome.Completed && c.Assessment == null, ct);
        var openAlerts = await db.Alerts.CountAsync(a => !a.Resolved, ct);
        var critical = await db.Alerts.CountAsync(a => !a.Resolved && a.Severity == AlertSeverity.Critical, ct);
        var patients = await GetPatientsAsync(ct: ct);
        var plans = await db.Patients.AsNoTracking()
            .Include(p => p.FollowUpPlan)
            .Include(p => p.CallSessions)
            .Where(p => p.FollowUpPlan != null && p.FollowUpPlan.Active && p.Status != PatientStatus.Completed)
            .ToListAsync(ct);

        var query = db.CallSessions.AsNoTracking().Include(c => c.Patient).Include(c => c.Assessment);
        var sessions = await query
            .OrderByDescending(c => c.Outcome == CallOutcome.Pending || (c.Outcome == CallOutcome.Completed && c.Assessment == null))
            .ThenByDescending(c => c.DateTime)
            .Take(12).ToListAsync(ct);

        // Preserve an operator's selection while new activity arrives.
        if (selectedCallId is { } selected && sessions.All(c => c.Id != selected))
        {
            var pinned = await query.FirstOrDefaultAsync(c => c.Id == selected, ct);
            if (pinned is not null) sessions.Add(pinned);
        }

        var ids = sessions.Select(c => c.Id).ToArray();
        var traces = await db.AgentTraces.AsNoTracking()
            .Where(t => t.CallSessionId != null && ids.Contains(t.CallSessionId.Value))
            .OrderBy(t => t.CreatedOn).ToListAsync(ct);
        var steps = traces.ToLookup(t => t.CallSessionId!.Value);
        var calls = sessions.Select(c => new MonitoringCall(
            c.Id, c.PatientId, c.Patient?.Name ?? "Patient unavailable", c.Patient?.PhoneNumber ?? string.Empty,
            c.Patient?.Diagnosis ?? string.Empty, c.DateTime, c.Outcome,
            !string.IsNullOrWhiteSpace(c.ExternalCallId), c.Assessment != null,
            c.Assessment?.RiskClassification, c.Assessment?.Summary,
            steps[c.Id].Select(AgentTracePresenter.ToViewModel).ToList(), c.Transcript)).ToList();

        calls.InsertRange(0, plans.Select(p => new
        {
            Patient = p,
            Dates = p.FollowUpPlan!.ScheduledDates.OrderBy(d => d).ToList(),
            CallCount = p.CallSessions.Count
        }).Where(x => x.CallCount < x.Dates.Count).Select(x => new MonitoringCall(
            x.Patient.Id, x.Patient.Id, x.Patient.Name, x.Patient.PhoneNumber, x.Patient.Diagnosis,
            x.Dates[x.CallCount], CallOutcome.Pending, false, false, null, null, [], Scheduled: true)));

        var alerts = await db.Alerts.AsNoTracking().Where(a => !a.Resolved)
            .OrderByDescending(a => a.Severity).ThenByDescending(a => a.CreatedOn)
            .Take(8)
            .Select(a => new AlertRow(a.Id, a.PatientId, a.Patient!.Name, a.Severity,
                a.Description, a.CreatedOn, a.Resolved)).ToListAsync(ct);

        var dates = await db.CallSessions.AsNoTracking()
            .Where(c => c.DateTime >= firstDay && c.DateTime <= now)
            .Select(c => c.DateTime).ToListAsync(ct);
        var counts = dates.GroupBy(d => DateOnly.FromDateTime(d)).ToDictionary(g => g.Key, g => g.Count());
        var days = Enumerable.Range(0, 7).Select(i =>
        {
            var day = DateOnly.FromDateTime(firstDay.AddDays(i));
            return new CallDay(day, counts.GetValueOrDefault(day));
        }).ToList();

        return new MonitoringSnapshot(now,
            schedulerOptions?.Enabled ?? configuration.GetValue("FollowUp:SchedulerEnabled", true), SimulateCalls,
            awaiting, unassessed, openAlerts, critical,
            patients.Count(p => p.Status == PatientStatus.InFollowUp), calls, alerts, patients, days);
    }
}
