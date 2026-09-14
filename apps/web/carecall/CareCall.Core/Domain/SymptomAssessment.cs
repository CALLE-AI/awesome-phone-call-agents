namespace CareCall.Core.Domain;

public class SymptomAssessment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CallSessionId { get; set; }
    public CallSession? CallSession { get; set; }

    public List<string> ExtractedSymptoms { get; set; } = [];
    public RiskLevel RiskClassification { get; set; } = RiskLevel.Low;
    public string Summary { get; set; } = string.Empty;

    /// <summary>The AI has detected worsening compared to the previous call.</summary>
    public bool WorseningDetected { get; set; }

    public DateTime CreatedOn { get; set; } = DateTime.UtcNow;
}
