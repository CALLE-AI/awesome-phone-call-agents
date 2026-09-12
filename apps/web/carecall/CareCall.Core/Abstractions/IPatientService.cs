using CareCall.Core.Domain;

namespace CareCall.Core.Abstractions;

public record PatientInput(
    string Name,
    string PhoneNumber,
    DateOnly BirthDate,
    DateTime DischargeDate,
    string Diagnosis,
    RiskLevel RiskLevel);

/// <summary>Patient CRUD and dashboard queries.</summary>
public interface IPatientService
{
    Task<IReadOnlyList<Patient>> GetAllAsync(CancellationToken ct = default);
    Task<Patient?> GetAsync(Guid id, CancellationToken ct = default);

    /// <summary>Creates the patient and their follow-up plan (+1/+3/+7 days).</summary>
    Task<Patient> CreateAsync(PatientInput input, CancellationToken ct = default);

    Task<Patient?> UpdateAsync(Guid id, PatientInput input, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}
