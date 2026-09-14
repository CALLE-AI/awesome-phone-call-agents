namespace CareCall.Core.Domain;

public class FollowUpPlan
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PatientId { get; set; }
    public Patient? Patient { get; set; }

    /// <summary>Scheduled dates for the follow-up calls.</summary>
    public List<DateTime> ScheduledDates { get; set; } = [];

    public bool Active { get; set; } = true;
}
