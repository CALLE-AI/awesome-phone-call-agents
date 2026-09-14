using CareCall.Core.Abstractions;
using CareCall.Core.Agents;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace CareCall.Tests;

public class IncrementalAgentTraceTests
{
    [Fact]
    public async Task Pipeline_PublishesEachStageBeforeTheNext_AndRetainsFallbackResults()
    {
        var options = new DbContextOptionsBuilder<CallEDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new CallEDbContext(options);
        var patient = new Patient { Name = "Demo patient" };
        var session = new CallSession { PatientId = patient.Id, Outcome = CallOutcome.Completed };
        db.Patients.Add(patient);
        db.CallSessions.Add(session);
        await db.SaveChangesAsync();
        var agents = new RecordingAgents(options);
        var pipeline = new ClinicalAgentPipeline(db, agents, agents, agents, agents, agents,
            NullLogger<ClinicalAgentPipeline>.Instance);

        var result = await pipeline.RunAsync(session, patient, "Short transcript requiring safety review.");

        await using var reader = new CallEDbContext(options);
        var traces = await reader.AgentTraces.OrderBy(t => t.Agent).ToListAsync();
        Assert.Equal(5, traces.Count);
        Assert.Equal(RiskLevel.Low, result.Assessment.RiskClassification);
        Assert.False(traces.Single(t => t.Agent == AgentKind.ClinicalHandoff).Succeeded);
        Assert.All(traces, trace => Assert.Equal(session.Id, trace.CallSessionId));
    }

    private sealed class RecordingAgents(DbContextOptions<CallEDbContext> options) :
        IClinicalAiService, ITrendAnalystAgent, IDevilsAdvocateAgent, IClinicalHandoffAgent, IAdaptiveSchedulerAgent
    {
        private async Task AssertPublishedAsync(int count, CancellationToken ct)
        {
            // A different context simulates the monitoring screen reading while the pipeline is running.
            await using var reader = new CallEDbContext(options);
            Assert.Equal(count, await reader.AgentTraces.CountAsync(ct));
        }

        public Task<string> GenerateSimulatedTranscriptAsync(Patient patient, IReadOnlyList<string> questions,
            CancellationToken ct = default) => Task.FromResult(string.Empty);

        public async Task<AgentRun<TrendAnalysisDto>> AnalyzeAsync(AgentContext context, CancellationToken ct = default)
        {
            await AssertPublishedAsync(0, ct);
            return new(new TrendAnalysisDto { Trajectory = "Stable" }, "{}", 1, true);
        }

        public async Task<SymptomAssessmentDto> AnalyzeTranscriptAsync(string transcript, Patient patient,
            string? previousSummary = null, CancellationToken ct = default)
        {
            await AssertPublishedAsync(1, ct);
            return new() { RiskClassification = RiskLevel.Low, Summary = "Stable" };
        }

        public async Task<AgentRun<ChallengeDto>> ChallengeAsync(AgentContext context,
            SymptomAssessmentDto assessment, CancellationToken ct = default)
        {
            await AssertPublishedAsync(2, ct);
            return new(new ChallengeDto { ChallengeFound = false }, "{}", 1, true);
        }

        public async Task<AgentRun<HandoffNoteDto>> WriteAsync(AgentContext context,
            SymptomAssessmentDto assessment, CancellationToken ct = default)
        {
            await AssertPublishedAsync(3, ct);
            return new(null, "", 1, false);
        }

        public async Task<AgentRun<SchedulingProposalDto>> ProposeAsync(AgentContext context,
            SymptomAssessmentDto assessment, CancellationToken ct = default)
        {
            await AssertPublishedAsync(4, ct);
            return new(new SchedulingProposalDto { NextCallInDays = 3 }, "{}", 1, true);
        }
    }
}
