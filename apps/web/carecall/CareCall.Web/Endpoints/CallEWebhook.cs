using CareCall.Core.Services;

namespace CareCall.Web.Endpoints;

public static class CallEWebhook
{
    /// <summary>Endpoint invoked by CALL-E when a call finishes.</summary>
    public static void MapCallEWebhook(this WebApplication app)
    {
        var group = app.MapGroup("/api/calls").DisableAntiforgery();

        group.MapPost("/completed", async (
            CallCompletedPayload payload,
            CallIngestionService ingestion,
            CallEOptions options,
            HttpRequest request,
            CancellationToken ct) =>
        {
            var expected = options.WebhookSecret;
            if (!string.IsNullOrWhiteSpace(expected) &&
                request.Headers["X-CallE-Secret"] != expected)
            {
                return Results.Unauthorized();
            }

            var assessment = await ingestion.IngestAsync(payload, ct);

            return assessment is null
                ? Results.Accepted()
                : Results.Ok(new
                {
                    assessment.Id,
                    assessment.RiskClassification,
                    assessment.Summary,
                    assessment.WorseningDetected
                });
        });
    }
}
