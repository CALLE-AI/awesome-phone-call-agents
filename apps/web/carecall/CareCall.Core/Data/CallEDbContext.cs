using System.Text.Json;
using CareCall.Core.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace CareCall.Core.Data;

public class CallEDbContext(DbContextOptions<CallEDbContext> options) : DbContext(options)
{
    public DbSet<Patient> Patients => Set<Patient>();
    public DbSet<FollowUpPlan> FollowUpPlans => Set<FollowUpPlan>();
    public DbSet<CallSession> CallSessions => Set<CallSession>();
    public DbSet<SymptomAssessment> SymptomAssessments => Set<SymptomAssessment>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<AgentTrace> AgentTraces => Set<AgentTrace>();
    public DbSet<DemoSettings> DemoSettings => Set<DemoSettings>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<DemoSettings>(e =>
        {
            e.Property(s => s.Id).ValueGeneratedNever();
            e.Property(s => s.PhoneNumber).HasMaxLength(30);
        });

        b.Entity<Patient>(e =>
        {
            e.Property(p => p.Name).HasMaxLength(200).IsRequired();
            e.Property(p => p.PhoneNumber).HasMaxLength(30).IsRequired();
            e.Property(p => p.Diagnosis).HasMaxLength(500);
            e.Ignore(p => p.Age);

            e.HasOne(p => p.FollowUpPlan)
             .WithOne(f => f.Patient)
             .HasForeignKey<FollowUpPlan>(f => f.PatientId)
             .OnDelete(DeleteBehavior.Cascade);

            e.HasMany(p => p.CallSessions)
             .WithOne(c => c.Patient)
             .HasForeignKey(c => c.PatientId)
             .OnDelete(DeleteBehavior.Cascade);

            e.HasMany(p => p.Alerts)
             .WithOne(a => a.Patient)
             .HasForeignKey(a => a.PatientId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<FollowUpPlan>()
         .Property(f => f.ScheduledDates)
         .HasConversion(DateListConverter)
         .Metadata.SetValueComparer(DateListComparer);

        b.Entity<CallSession>(e =>
        {
            e.Property(c => c.ExternalCallId).HasMaxLength(100);
            e.HasOne(c => c.Assessment)
             .WithOne(a => a.CallSession)
             .HasForeignKey<SymptomAssessment>(a => a.CallSessionId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SymptomAssessment>()
         .Property(a => a.ExtractedSymptoms)
         .HasConversion(StringListConverter)
         .Metadata.SetValueComparer(StringListComparer);

        b.Entity<Alert>()
         .Property(a => a.Description).HasMaxLength(1000);

        b.Entity<AgentTrace>(e =>
        {
            e.Property(t => t.Outcome).HasMaxLength(500);
            e.Property(t => t.Rationale).HasMaxLength(2000);

            // The trace survives session deletion: it is audit material.
            e.HasOne(t => t.CallSession)
             .WithMany()
             .HasForeignKey(t => t.CallSessionId)
             .OnDelete(DeleteBehavior.SetNull);

            e.HasOne(t => t.Patient)
             .WithMany()
             .HasForeignKey(t => t.PatientId)
             .OnDelete(DeleteBehavior.Cascade);

            // The panel queries by session and by agent in chronological order.
            e.HasIndex(t => new { t.CallSessionId, t.Agent });
            e.HasIndex(t => t.PatientId);
        });
    }

    private static ValueConverter<List<string>, string> StringListConverter { get; } =
        new(v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
            v => JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null) ?? new());

    private static ValueComparer<List<string>> StringListComparer { get; } =
        new((a, c) => a!.SequenceEqual(c!), v => v.Aggregate(0, (h, s) => HashCode.Combine(h, s.GetHashCode())), v => v.ToList());

    private static ValueConverter<List<DateTime>, string> DateListConverter { get; } =
        new(v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
            v => JsonSerializer.Deserialize<List<DateTime>>(v, (JsonSerializerOptions?)null) ?? new());

    private static ValueComparer<List<DateTime>> DateListComparer { get; } =
        new((a, c) => a!.SequenceEqual(c!), v => v.Aggregate(0, (h, d) => HashCode.Combine(h, d.GetHashCode())), v => v.ToList());
}
