namespace CareCall.Core.Domain;

public class CallSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PatientId { get; set; }
    public Patient? Patient { get; set; }

    public DateTime DateTime { get; set; } = DateTime.UtcNow;
    public TimeSpan Duration { get; set; }
    public CallOutcome Outcome { get; set; } = CallOutcome.Pending;
    public string Transcript { get; set; } = string.Empty;

    /// <summary>Call identifier on the CALL-E platform.</summary>
    public string? ExternalCallId { get; set; }

    public SymptomAssessment? Assessment { get; set; }
}
