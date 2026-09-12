using System.Net;
using System.Text.Json;
using CareCall.Core.Abstractions;
using CareCall.Core.Data;
using CareCall.Core.Domain;
using CareCall.Core.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace CareCall.Tests;

public class CallEApiClientTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Requests_UseLatestApiKey_WithoutRecreatingClient(bool createCall)
    {
        using var handler = new RecordingHandler();
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://example.invalid") };
        var options = new CallEOptions { ApiKey = "first-test-key" };
        var client = new CallEApiClient(http, options);

        await SendAsync();
        options.ApiKey = "replacement-test-key";
        await SendAsync();

        Assert.Equal(["first-test-key", "replacement-test-key"], handler.ApiKeys);

        Task<JsonElement> SendAsync() => createCall
            ? client.CreateCallAsync("+34600000000", "Test task", "ES", "es-ES", "test-id", null, null)
            : client.GetCallAsync("test-call");
    }

    [Fact]
    public async Task Request_WithoutApiKey_DoesNotContactProvider()
    {
        using var handler = new RecordingHandler();
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://example.invalid") };
        var client = new CallEApiClient(http, new CallEOptions());

        await Assert.ThrowsAsync<InvalidOperationException>(() => client.GetCallAsync("test-call"));

        Assert.Empty(handler.ApiKeys);
    }

    [Fact]
    public async Task StartCall_UsesConfiguredDemoPhone_EvenForPreviouslyLoadedPatient()
    {
        using var handler = new RecordingHandler();
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://example.invalid") };
        var options = new CallEOptions { ApiKey = "test-key", DemoPhoneNumber = "+34600000000", SimulateCalls = false };
        var client = new CallEApiClient(http, options);
        using var db = new CallEDbContext(new DbContextOptionsBuilder<CallEDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var patient = new Patient { Name = "Test", PhoneNumber = "+34999999999" };
        db.Patients.Add(patient);
        await db.SaveChangesAsync();
        var service = new CallEService(client, options, db, NullLogger<CallEService>.Instance);

        await service.StartCallAsync(patient, new FollowUpContext(patient.Name, "Test", DateTime.UtcNow, 1, null));

        using var payload = JsonDocument.Parse(Assert.Single(handler.Payloads));
        Assert.Equal(options.DemoPhoneNumber, payload.RootElement.GetProperty("recipients")[0].GetProperty("phones")[0].GetString());
    }

    [Fact]
    public async Task StartCall_InSimulation_DoesNotContactProvider()
    {
        using var handler = new RecordingHandler();
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://example.invalid") };
        var options = new CallEOptions { ApiKey = "test-key", SimulateCalls = true };
        var client = new CallEApiClient(http, options);
        using var db = new CallEDbContext(new DbContextOptionsBuilder<CallEDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var patient = new Patient { Name = "Test", PhoneNumber = "+34600000000" };
        db.Patients.Add(patient);
        await db.SaveChangesAsync();

        var session = await new CallEService(client, options, db, NullLogger<CallEService>.Instance)
            .StartCallAsync(patient, new FollowUpContext(patient.Name, "Test", DateTime.UtcNow, 1, null));

        Assert.Equal(CallOutcome.Pending, session.Outcome);
        Assert.Empty(handler.Payloads);
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public List<string?> ApiKeys { get; } = [];
        public List<string> Payloads { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            ApiKeys.Add(request.Headers.Authorization?.Parameter);
            if (request.Content is not null)
                Payloads.Add(await request.Content.ReadAsStringAsync(ct));
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"id\":\"test-call\"}")
            };
        }
    }
}
