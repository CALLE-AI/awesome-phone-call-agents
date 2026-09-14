namespace CareCall.Core.Domain;

public class Alert
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PatientId { get; set; }
    public Patient? Patient { get; set; }

    public AlertSeverity Severity { get; set; } = AlertSeverity.Info;
    public string Description { get; set; } = string.Empty;
    public DateTime CreatedOn { get; set; } = DateTime.UtcNow;
    public bool Resolved { get; set; }
}
