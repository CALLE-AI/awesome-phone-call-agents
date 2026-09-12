using System.ComponentModel.DataAnnotations;
using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using CareCall.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace CareCall.Web.Services;

public class PatientRegistrationInput : IValidatableObject
{
    [Required, StringLength(200)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [RegularExpression(@"^\+[1-9]\d{7,14}$", ErrorMessage = "Enter an international phone number, for example +34600000000.")]
    public string PhoneNumber { get; set; } = string.Empty;

    [Required, StringLength(500)]
    public string Diagnosis { get; set; } = string.Empty;

    [Required]
    public DateOnly? BirthDate { get; set; }

    public RiskLevel RiskLevel { get; set; } = RiskLevel.Low;

    [Range(1, 60)]
    public int TrialDelayMinutes { get; set; } = 1;

    public string? JudgePassword { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (BirthDate is { } date && (date == DateOnly.MinValue || date > DateOnly.FromDateTime(DateTime.UtcNow)))
            yield return new ValidationResult("Enter a valid birth date, not in the future.", [nameof(BirthDate)]);
        if (!Enum.IsDefined(RiskLevel))
            yield return new ValidationResult("Select a valid initial risk level.", [nameof(RiskLevel)]);
    }
}

public record PatientRegistrationResult(Guid PatientId, string Message, bool CallStarted);

public class PatientRegistrationService(
    IDbContextFactory<CallEDbContext> factory,
    CallEOptions callOptions,
    FollowUpSchedulerOptions schedulerOptions,
    TimeProvider clock,
    IJudgeAccess judgeAccess)
{
    private static readonly SemaphoreSlim RegistrationLock = new(1, 1);

    public async Task<PatientRegistrationResult> RegisterAsync(
        PatientRegistrationInput input, bool liveTrial, CancellationToken ct = default)
    {
        await RegistrationLock.WaitAsync(ct);
        try
        {
            return await RegisterCoreAsync(input, liveTrial, ct);
        }
        finally
        {
            RegistrationLock.Release();
        }
    }

    private async Task<PatientRegistrationResult> RegisterCoreAsync(
        PatientRegistrationInput input, bool liveTrial, CancellationToken ct)
    {
        Validator.ValidateObject(input, new ValidationContext(input), validateAllProperties: true);
        if (liveTrial && !judgeAccess.IsAuthorized(input.JudgePassword))
            throw new ValidationException("Enter the judge password to create a trial patient.");

        var now = clock.GetUtcNow().UtcDateTime;
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var patient = await new PatientService(db).CreateAsync(new PatientInput(
            input.Name.Trim(), input.PhoneNumber, input.BirthDate!.Value, now,
            input.Diagnosis.Trim(), input.RiskLevel), ct);

        if (liveTrial)
        {
            // One scheduled trial call, governed by the shared simulation mode.
            patient.FollowUpPlan!.ScheduledDates = [now.AddMinutes(input.TrialDelayMinutes)];
            await db.SaveChangesAsync(ct);
        }
        await transaction.CommitAsync(ct);

        if (!liveTrial)
            return new(patient.Id, schedulerOptions.Enabled && callOptions.Enabled && callOptions.IsConfigured
                ? "Patient registered. Follow-up calls scheduled for 1, 3 and 7 days after discharge."
                : "Patient registered with a 1, 3 and 7 day follow-up plan. Automatic calling is currently disabled or not configured.", false);

        return new(patient.Id,
            $"Patient registered. Trial call scheduled for {input.TrialDelayMinutes} minute(s); it will use the current call mode.", false);
    }
}
