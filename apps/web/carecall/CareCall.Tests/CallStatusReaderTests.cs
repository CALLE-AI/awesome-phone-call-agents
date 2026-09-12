using System.Text.Json;
using CareCall.Core.Services;

namespace CareCall.Tests;

/// <summary>
/// Based on the REAL response from GET /v1/calls/{id} captured in the test
/// call call_TeMZ2l7j7Ny9d8mHoAj6mw.
/// </summary>
public class CallStatusReaderTests
{
    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    private const string RealResponse = """
        {
          "id": "call_TeMZ2l7j7Ny9d8mHoAj6mw",
          "status": "completed",
          "summary": "The test follow-up call was completed.",
          "task_completed": true,
          "completion_confidence": { "score": 0.86, "label": "high" },
          "evidence": [
            "A live recipient answered and engaged with the brief discharge check-in.",
            "They reported feeling okay overall, with possible fever and nighttime breathing trouble noted."
          ],
          "recipients": [
            {
              "id": "rcp_b0028fd5b1b6a4ab",
              "status": "completed",
              "structured_result": null,
              "summary": "Recipient answered the check-in questions.",
              "attempts": [
                {
                  "status": "completed",
                  "started_at": "2026-08-28T10:47:53",
                  "completed_at": "2026-08-28T10:48:45",
                  "transcript_turns": [
                    { "offset_seconds": 0,  "speaker": "bot",  "text": "Hi, this is CALL-E." },
                    { "offset_seconds": 21, "speaker": "user", "text": "Well, I'm actually OK." },
                    { "offset_seconds": 32, "speaker": "user", "text": "Yes. yes" },
                    { "offset_seconds": 48, "speaker": "bot",  "text": "bye." }
                  ]
                }
              ]
            }
          ]
        }
        """;

    [Fact]
    public void ReadState_UsesRecipientStatus()
        => Assert.Equal("completed", CallStatusReader.ReadState(Json(RealResponse)));

    [Fact]
    public void ReadState_PrefersRecipient_WhenTaskStillQueued()
    {
        // Real case: the task is still "queued" but the recipient is already in progress.
        var el = Json("""
            {"status":"queued","recipients":[{"status":"in_progress","attempts":[]}]}
            """);

        Assert.Equal("in_progress", CallStatusReader.ReadState(el));
        Assert.False(CallStatusReader.IsTerminal(CallStatusReader.ReadState(el)));
    }

    [Theory]
    [InlineData("completed", true)]
    [InlineData("failed", true)]
    [InlineData("no_answer", true)]
    [InlineData("in_progress", false)]
    [InlineData("queued", false)]
    [InlineData("pending", false)]
    [InlineData(null, false)]
    public void IsTerminal_DetectsFinishedCalls(string? state, bool expected)
        => Assert.Equal(expected, CallStatusReader.IsTerminal(state));

    [Fact]
    public void ReadTranscript_MapsSpeakersToRoles()
    {
        var transcript = CallStatusReader.ReadTranscript(Json(RealResponse));

        Assert.Contains("CALL-E: Hi, this is CALL-E.", transcript);
        Assert.Contains("Patient: Well, I'm actually OK.", transcript);
        Assert.DoesNotContain("bot:", transcript);
    }

    [Fact]
    public void ReadDuration_UsesLastTranscriptOffset()
        => Assert.Equal(48, CallStatusReader.ReadDuration(Json(RealResponse)));

    [Fact]
    public void ReadDuration_FallsBackToTimestamps_WhenNoTurns()
    {
        var el = Json("""
            {"recipients":[{"attempts":[{"started_at":"2026-08-28T10:47:53","completed_at":"2026-08-28T10:48:45","transcript_turns":[]}]}]}
            """);

        Assert.Equal(52, CallStatusReader.ReadDuration(el));
    }

    [Fact]
    public void ReadSummary_PrefersRecipientSummary()
        => Assert.Equal("Recipient answered the check-in questions.", CallStatusReader.ReadSummary(Json(RealResponse)));

    [Fact]
    public void ReadEvidence_ReturnsAllItems()
        => Assert.Equal(2, CallStatusReader.ReadEvidence(Json(RealResponse)).Count);

    [Fact]
    public void ReadTranscript_FallsBackToSummary_WhenNoTurns()
    {
        var el = Json("""
            {"summary":"Voicemail reached.","recipients":[{"status":"completed","attempts":[{"transcript_turns":[]}]}]}
            """);

        Assert.Equal("Voicemail reached.", CallStatusReader.ReadTranscript(el));
    }

    [Fact]
    public void Readers_ReturnDefaults_WhenPayloadEmpty()
    {
        var el = Json("""{"recipients":[]}""");

        Assert.Null(CallStatusReader.ReadState(el));
        Assert.Null(CallStatusReader.ReadDuration(el));
        Assert.Empty(CallStatusReader.ReadTranscript(el));
        Assert.Empty(CallStatusReader.ReadEvidence(el));
    }
}
