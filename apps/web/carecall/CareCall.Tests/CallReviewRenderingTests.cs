using CareCall.Web.Components.Shared;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace CareCall.Tests;

public class CallReviewRenderingTests
{
    [Fact]
    public async Task Review_RendersAccessibleTabs_AndEncodesSavedTranscript()
    {
        var html = await RenderAsync("Patient: <script>alert('unsafe')</script>");

        Assert.Contains("role=\"tablist\"", html);
        Assert.Contains("role=\"tab\"", html);
        Assert.Contains("role=\"tabpanel\"", html);
        Assert.Contains("aria-controls=", html);
        Assert.Contains("Agent activity", html);
        Assert.Contains("Transcript", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.DoesNotContain("<script>", html);
    }

    [Fact]
    public async Task Review_RendersExplicitSpeakersAsOpposingClinicalChatMessages()
    {
        var html = await RenderAsync("CALL-E: How are you feeling?\nPatient: Better today.");

        Assert.Contains("message-row agent", html);
        Assert.Contains("message-row patient", html);
        Assert.Contains("support_agent", html);
        Assert.Contains("CALL-E", html);
        Assert.Contains("How are you feeling?", html);
        Assert.Contains("Better today.", html);
    }

    [Fact]
    public async Task Review_DoesNotInventSpeakersForUndiarizedText()
    {
        var html = await RenderAsync("Feeling better - less pain.\nTaking medication as directed.");

        Assert.Contains("message-row neutral", html);
        Assert.DoesNotContain("message-row patient", html);
        Assert.DoesNotContain("message-row agent", html);
        Assert.Contains("Feeling better - less pain.", html);
        Assert.Contains("Taking medication as directed.", html);
    }

    [Fact]
    public async Task Review_PreservesMultilineTurns_AndLegacyPatientLabels()
    {
        var html = await RenderAsync("CALL-E: Tell me about your symptoms.\r\nAny fever?\r\nPaciente: No fever - feeling better.");
        var decoded = System.Net.WebUtility.HtmlDecode(html);

        Assert.Contains("Tell me about your symptoms.\nAny fever?", decoded);
        Assert.Contains("message-row patient", html);
        Assert.Contains("No fever - feeling better.", html);
    }

    [Fact]
    public async Task Review_ExplainsMissingData_WithoutInventingLiveActivity()
    {
        var html = await RenderAsync(string.Empty);

        Assert.Contains("No transcript received for this session yet.", html);
        Assert.Contains("No agent results recorded for this session yet.", html);
        Assert.Contains("not live audio", html);
    }

    private static async Task<string> RenderAsync(string transcript)
    {
        await using var services = new ServiceCollection().AddLogging().BuildServiceProvider();
        await using var renderer = new HtmlRenderer(services, services.GetRequiredService<ILoggerFactory>());
        return await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var parameters = ParameterView.FromDictionary(new Dictionary<string, object?>
            {
                [nameof(CallReview.Transcript)] = transcript
            });
            var result = await renderer.RenderComponentAsync<CallReview>(parameters);
            return result.ToHtmlString();
        });
    }
}
