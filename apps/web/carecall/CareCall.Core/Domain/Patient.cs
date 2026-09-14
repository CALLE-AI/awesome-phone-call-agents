namespace CareCall.Core.Domain;

public class Patient
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string PhoneNumber { get; set; } = string.Empty;
    public DateOnly BirthDate { get; set; }
    public DateTime DischargeDate { get; set; }
    public string Diagnosis { get; set; } = string.Empty;
    public RiskLevel RiskLevel { get; set; } = RiskLevel.Low;
    public PatientStatus Status { get; set; } = PatientStatus.Discharged;

    public FollowUpPlan? FollowUpPlan { get; set; }
    public List<CallSession> CallSessions { get; set; } = [];
    public List<Alert> Alerts { get; set; } = [];

    public int Age => DateOnly.FromDateTime(DateTime.Today).Year - BirthDate.Year
        - (DateOnly.FromDateTime(DateTime.Today) < BirthDate.AddYears(DateOnly.FromDateTime(DateTime.Today).Year - BirthDate.Year) ? 1 : 0);
}
