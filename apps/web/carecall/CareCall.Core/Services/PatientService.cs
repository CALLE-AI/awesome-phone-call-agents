using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using Microsoft.EntityFrameworkCore;

namespace CareCall.Core.Services;

public class PatientService(CallEDbContext db) : IPatientService
{
    public async Task<IReadOnlyList<Patient>> GetAllAsync(CancellationToken ct = default) =>
        await db.Patients
            .Include(p => p.FollowUpPlan)
            .Include(p => p.Alerts)
            .OrderByDescending(p => p.DischargeDate)
            .AsSplitQuery()
            .ToListAsync(ct);

    public async Task<Patient?> GetAsync(Guid id, CancellationToken ct = default) =>
        await db.Patients
            .Include(p => p.FollowUpPlan)
            .Include(p => p.Alerts)
            .Include(p => p.CallSessions).ThenInclude(c => c.Assessment)
            .AsSplitQuery()
            .FirstOrDefaultAsync(p => p.Id == id, ct);

    public async Task<Patient> CreateAsync(PatientInput input, CancellationToken ct = default)
    {
        var phoneNumber = input.PhoneNumber.Trim();
        if (await db.Patients.AnyAsync(p => p.PhoneNumber == phoneNumber, ct))
            throw new InvalidOperationException("A patient with this phone number already exists.");

        var patient = new Patient
        {
            Name = input.Name,
            PhoneNumber = phoneNumber,
            BirthDate = input.BirthDate,
            DischargeDate = input.DischargeDate,
            Diagnosis = input.Diagnosis,
            RiskLevel = input.RiskLevel,
            Status = PatientStatus.InFollowUp
        };

        patient.FollowUpPlan = new FollowUpPlan
        {
            PatientId = patient.Id,
            Active = true,
            ScheduledDates = AlertRules.BuildSchedule(input.DischargeDate)
        };

        db.Patients.Add(patient);
        await db.SaveChangesAsync(ct);
        return patient;
    }

    public async Task<Patient?> UpdateAsync(Guid id, PatientInput input, CancellationToken ct = default)
    {
        var patient = await db.Patients
            .Include(p => p.FollowUpPlan)
            .FirstOrDefaultAsync(p => p.Id == id, ct);

        if (patient is null) return null;

        var dischargeChanged = patient.DischargeDate != input.DischargeDate;

        patient.Name = input.Name;
        patient.PhoneNumber = input.PhoneNumber;
        patient.BirthDate = input.BirthDate;
        patient.DischargeDate = input.DischargeDate;
        patient.Diagnosis = input.Diagnosis;
        patient.RiskLevel = input.RiskLevel;

        if (dischargeChanged && patient.FollowUpPlan is not null)
            patient.FollowUpPlan.ScheduledDates = AlertRules.BuildSchedule(input.DischargeDate);

        await db.SaveChangesAsync(ct);
        return patient;
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var patient = await db.Patients.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (patient is null) return false;

        db.Patients.Remove(patient);
        await db.SaveChangesAsync(ct);
        return true;
    }
}
