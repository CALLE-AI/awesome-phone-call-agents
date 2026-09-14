using CareCall.Core.Domain;

namespace CareCall.Core.Abstractions;

/// <summary>Data the call AI needs to drive the follow-up.</summary>
public record FollowUpContext(
    string PatientName,
    string Diagnosis,
    DateTime DischargeDate,
    int CallNumber,
    string? PreviousSummary);

/// <summary>Integration with the CALL-E platform (telephony + voice).</summary>
public interface ICallEService
{
    /// <summary>Starts the call and returns the persisted session (or pending webhook).</summary>
    Task<CallSession> StartCallAsync(Patient patient, FollowUpContext context, CancellationToken ct = default);
}
