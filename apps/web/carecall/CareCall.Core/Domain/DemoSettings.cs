namespace CareCall.Core.Domain;

public class DemoSettings
{
    public int Id { get; set; } = 1;
    public string ProtectedApiKey { get; set; } = string.Empty;
    public string PhoneNumber { get; set; } = string.Empty;
    public bool SetupCompleted { get; set; }
    public bool AutomaticCallsEnabled { get; set; }
}
