using CareCall.Core.Domain;

namespace CareCall.Core.Abstractions;

/// <summary>Follow-up orchestration: plans, pending calls and alerts.</summary>
public interface IFollowUpService
{
    Task<FollowUpPlan> CreatePlanAsync(Guid patientId, CancellationToken ct = default);

    /// <summary>Patients with a scheduled call whose date has already passed.</summary>
    Task<IReadOnlyList<Patient>> GetDueCallsAsync(DateTime now, CancellationToken ct = default);

    /// <summary>Persists the call analysis and applies the alert rules.</summary>
    Task<SymptomAssessment> RegisterAssessmentAsync(Guid callSessionId, SymptomAssessmentDto dto, CancellationToken ct = default);

    Task ResolveAlertAsync(Guid alertId, CancellationToken ct = default);
}
