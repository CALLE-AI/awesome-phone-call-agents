using CareCall.Core.Abstractions;
using CareCall.Core.Agents;
using CareCall.Core.Domain;

namespace CareCall.Tests;

/// <summary>
/// Agents are non-deterministic, but the safety guarantees are NOT:
/// they live in code and are tested here. These tests are the net that prevents a
/// model hallucination from changing a clinical decision.
/// </summary>
public class AgentGuardrailTests
{
    private const string Transcript =
        "Nurse: How are you feeling today? Patient: Last night I could not breathe " +
        "even sitting down, and my fever hit 39.2 degrees. Nurse: Are you taking the antibiotic? " +
        "Patient: Yes, every eight hours.";

    // --- Devil's Advocate: the literal quote must exist in the transcript ---

    [Fact]
    public void Validate_UpgradesRisk_WhenQuoteIsVerbatim()
    {
        var dto = new ChallengeDto
        {
            ChallengeFound = true,
            OverriddenRisk = RiskLevel.High,
            SupportingQuote = "I could not breathe even sitting down"
        };

        var result = DevilsAdvocateAgent.Validate(dto, Transcript, RiskLevel.Medium);

        Assert.True(result.QuoteVerified);
        Assert.Equal(RiskLevel.High, result.OverriddenRisk);
    }

    [Fact]
    public void Validate_IgnoresChallenge_WhenQuoteIsInvented()
    {
        // The model hallucinates a phrase the patient never said.
        var dto = new ChallengeDto
        {
            ChallengeFound = true,
            OverriddenRisk = RiskLevel.High,
            SupportingQuote = "I have been coughing up blood since Tuesday"
        };

        var result = DevilsAdvocateAgent.Validate(dto, Transcript, RiskLevel.Low);

        Assert.False(result.QuoteVerified);
        Assert.Null(result.OverriddenRisk);
    }

    [Fact]
    public void DevilAdvocateCannotReduceRiskTest()
    {
        const RiskLevel clinicalAnalystRisk = RiskLevel.Medium;
        var dto = new ChallengeDto
        {
            ChallengeFound = true,
            OverriddenRisk = RiskLevel.Low,
            SupportingQuote = "my fever hit 39.2 degrees"
        };

        var result = DevilsAdvocateAgent.Validate(dto, Transcript, clinicalAnalystRisk);
        var finalRisk = result.OverriddenRisk ?? clinicalAnalystRisk;

        Assert.Null(result.OverriddenRisk);
        Assert.Equal(RiskLevel.Medium, finalRisk);
    }

    [Fact]
    public void Validate_CapsEscalation_ToASingleLevel()
    {
        var dto = new ChallengeDto
        {
            ChallengeFound = true,
            OverriddenRisk = RiskLevel.High,
            SupportingQuote = "my fever hit 39.2 degrees"
        };

        var result = DevilsAdvocateAgent.Validate(dto, Transcript, RiskLevel.Low);

        // Low -> High would be a two-level jump: it is capped to Medium.
        Assert.Equal(RiskLevel.Medium, result.OverriddenRisk);
    }

    [Fact]
    public void Validate_NeverLowersRisk()
    {
        var dto = new ChallengeDto
        {
            ChallengeFound = true,
            OverriddenRisk = RiskLevel.Low,
            SupportingQuote = "Yes, every eight hours"
        };

        var result = DevilsAdvocateAgent.Validate(dto, Transcript, RiskLevel.High);

        // The reviewer can only raise the risk, never lower it.
        Assert.Null(result.OverriddenRisk);
    }

    [Fact]
    public void Validate_ClearsOverride_WhenNoChallengeWasFound()
    {
        var dto = new ChallengeDto
        {
            ChallengeFound = false,
            OverriddenRisk = RiskLevel.High,
            SupportingQuote = "my fever hit 39.2 degrees"
        };

        var result = DevilsAdvocateAgent.Validate(dto, Transcript, RiskLevel.Low);

        Assert.Null(result.OverriddenRisk);
    }

    [Theory]
    [InlineData("MY FEVER HIT 39.2 DEGREES")]      // uppercase
    [InlineData("my  fever   hit 39.2 degrees")]   // extra spaces
    [InlineData("my fever hit 39.2 degrees.")]     // trailing punctuation
    public void QuoteAppearsIn_ToleratesFormattingDifferences(string quote)
    {
        Assert.True(DevilsAdvocateAgent.QuoteAppearsIn(quote, Transcript));
    }

    [Theory]
    [InlineData("Yes")]     // too short to prove anything
    [InlineData("")]
    [InlineData(null)]
    public void QuoteAppearsIn_RejectsQuotesTooShortToBeEvidence(string? quote)
    {
        Assert.False(DevilsAdvocateAgent.QuoteAppearsIn(quote, Transcript));
    }

    [Fact]
    public void ShouldReview_TriggersOnHighRiskWorseningOrShortTranscript()
    {
        var high = new SymptomAssessmentDto { RiskClassification = RiskLevel.High };
        var worsening = new SymptomAssessmentDto { WorseningDetected = true };
        var benign = new SymptomAssessmentDto { RiskClassification = RiskLevel.Low };

        Assert.True(DevilsAdvocateAgent.ShouldReview(high, new string('x', 800)));
        Assert.True(DevilsAdvocateAgent.ShouldReview(worsening, new string('x', 800)));
        // Transcript too short: not enough information, needs review.
        Assert.True(DevilsAdvocateAgent.ShouldReview(benign, "Fine, thanks."));
        // Well-documented benign case: we don't spend a call to the model.
        Assert.False(DevilsAdvocateAgent.ShouldReview(benign, new string('x', 800)));
    }

    // --- Adaptive Scheduler: 24h floor and never closing risky follow-ups ---

    [Fact]
    public void ApplyGuardrails_EnforcesMinimumOfOneDay()
    {
        var proposal = new SchedulingProposalDto { NextCallInDays = 0 };
        var stable = new SymptomAssessmentDto { RiskClassification = RiskLevel.Low };

        var result = AdaptiveSchedulerAgent.ApplyGuardrails(proposal, stable);

        Assert.Equal(AdaptiveSchedulerAgent.MinDays, result.NextCallInDays);
    }

    [Fact]
    public void ApplyGuardrails_EnforcesMaximumInterval()
    {
        var proposal = new SchedulingProposalDto { NextCallInDays = 90 };
        var stable = new SymptomAssessmentDto { RiskClassification = RiskLevel.Low };

        var result = AdaptiveSchedulerAgent.ApplyGuardrails(proposal, stable);

        Assert.Equal(AdaptiveSchedulerAgent.MaxDays, result.NextCallInDays);
    }

    [Fact]
    public void ApplyGuardrails_NeverDischargesAWorseningPatient()
    {
        var proposal = new SchedulingProposalDto { NextCallInDays = 7, DischargeFollowUp = true };
        var worsening = new SymptomAssessmentDto { WorseningDetected = true };

        var result = AdaptiveSchedulerAgent.ApplyGuardrails(proposal, worsening);

        Assert.False(result.DischargeFollowUp);
        Assert.Equal(AdaptiveSchedulerAgent.MinDays, result.NextCallInDays);
    }

    [Fact]
    public void ApplyGuardrails_NeverDischargesAHighRiskPatient()
    {
        var proposal = new SchedulingProposalDto { NextCallInDays = 10, DischargeFollowUp = true };
        var high = new SymptomAssessmentDto { RiskClassification = RiskLevel.High };

        var result = AdaptiveSchedulerAgent.ApplyGuardrails(proposal, high);

        Assert.False(result.DischargeFollowUp);
        Assert.Equal(1, result.NextCallInDays);
    }

    [Fact]
    public void ApplyGuardrails_RespectsValidProposals()
    {
        var proposal = new SchedulingProposalDto { NextCallInDays = 5, DischargeFollowUp = false };
        var stable = new SymptomAssessmentDto { RiskClassification = RiskLevel.Low };

        var result = AdaptiveSchedulerAgent.ApplyGuardrails(proposal, stable);

        Assert.Equal(5, result.NextCallInDays);
    }
}
