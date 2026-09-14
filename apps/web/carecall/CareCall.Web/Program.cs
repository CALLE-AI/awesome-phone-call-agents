using CareCall.Core.Abstractions;
using CareCall.Core.Agents;
using CareCall.Core.Data;
using CareCall.Core.Services;
using CareCall.Web.Components;
using CareCall.Web.Endpoints;
using CareCall.Web.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.SemanticKernel;
using System.Net;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();
builder.Services.AddDataProtection().SetApplicationName("CallE");
builder.Services.AddSingleton(TimeProvider.System);

builder.Services.AddDbContextFactory<CallEDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("CallE") ?? "Data Source=calle.db"));

// Scoped DbContext built from the factory (convenient for write services).
builder.Services.AddScoped(sp => sp.GetRequiredService<IDbContextFactory<CallEDbContext>>().CreateDbContext());

// === Dev A DI (patients, follow-up, alerts) ===
builder.Services.AddScoped<IPatientService, PatientService>();
builder.Services.AddScoped<IFollowUpService, FollowUpService>();
builder.Services.AddSingleton(new FollowUpSchedulerOptions
{
    Interval = TimeSpan.FromSeconds(30),
    Enabled = builder.Configuration.GetValue("FollowUp:SchedulerEnabled", true)
});
builder.Services.AddHostedService<FollowUpScheduler>();

// === Dev B DI (CALL-E, Semantic Kernel) ===
var aiOptions = builder.Configuration.GetSection("ClinicalAi").Get<ClinicalAiOptions>() ?? new ClinicalAiOptions();
builder.Services.AddSingleton(aiOptions);

if (aiOptions.IsConfigured)
{
    var kernelBuilder = builder.Services.AddKernel();

    // The corporate network requires a proxy to reach Azure OpenAI. SK uses its own
    // HttpClient, so it must be injected explicitly.
    var aiHttpClient = new HttpClient(new HttpClientHandler
    {
        Proxy = string.IsNullOrWhiteSpace(aiOptions.Proxy) ? null : new WebProxy(aiOptions.Proxy),
        UseProxy = !string.IsNullOrWhiteSpace(aiOptions.Proxy)
    })
    {
        Timeout = TimeSpan.FromSeconds(60)
    };

    if (aiOptions.Provider.Equals("AzureOpenAI", StringComparison.OrdinalIgnoreCase))
        kernelBuilder.AddAzureOpenAIChatCompletion(aiOptions.Model, aiOptions.Endpoint!, aiOptions.ApiKey!, httpClient: aiHttpClient);
    else
        kernelBuilder.AddOpenAIChatCompletion(aiOptions.Model, aiOptions.ApiKey!, httpClient: aiHttpClient);

    builder.Services.AddScoped<IClinicalAiService, ClinicalAiService>();

    // === Agentic pipeline ===
    // Only registered if AI is configured: without it, CallIngestionService and
    // CallEService receive null and fall back to basic behavior.
    builder.Services.AddScoped<AgentRunner>();
    builder.Services.AddScoped<IQuestionPlannerAgent, QuestionPlannerAgent>();
    builder.Services.AddScoped<ITrendAnalystAgent, TrendAnalystAgent>();
    builder.Services.AddScoped<IDevilsAdvocateAgent, DevilsAdvocateAgent>();
    builder.Services.AddScoped<IClinicalHandoffAgent, ClinicalHandoffAgent>();
    builder.Services.AddScoped<IAdaptiveSchedulerAgent, AdaptiveSchedulerAgent>();
    builder.Services.AddScoped<ClinicalAgentPipeline>();
}
else
{
    // Without LLM credentials the app still starts and the demo works offline.
    builder.Services.AddScoped<IClinicalAiService, HeuristicClinicalAiService>();
}

var callEOptions = builder.Configuration.GetSection("CallE").Get<CallEOptions>() ?? new CallEOptions();
builder.Services.AddSingleton(callEOptions);

builder.Services.AddHttpClient<CallEApiClient>(client =>
{
    client.BaseAddress = new Uri(callEOptions.BaseUrl);
    client.Timeout = callEOptions.RequestTimeout;
})
.ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    Proxy = string.IsNullOrWhiteSpace(callEOptions.Proxy) ? null : new WebProxy(callEOptions.Proxy),
    UseProxy = !string.IsNullOrWhiteSpace(callEOptions.Proxy)
});

builder.Services.AddScoped<ICallEService, CallEService>();
builder.Services.AddScoped<CallIngestionService>();
builder.Services.AddSingleton(new CallPollerOptions
{
    Interval = TimeSpan.FromSeconds(20),
    // Solo sondeamos si no hay webhook publico configurado.
    Enabled = callEOptions.PollerEnabled && string.IsNullOrWhiteSpace(callEOptions.WebhookUrl)
});
builder.Services.AddHostedService<CallPoller>();

// === DI Dev C (dashboard) ===
builder.Services.AddScoped<DashboardService>();
builder.Services.AddScoped<PatientRegistrationService>();
builder.Services.AddSingleton<IJudgeAccess, JudgeAccessService>();
builder.Services.AddSingleton<DemoSettingsService>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CallEDbContext>();
    await DbSeeder.SeedAsync(db);
}
await app.Services.GetRequiredService<DemoSettingsService>().InitializeAsync();
app.Services.GetRequiredService<FollowUpSchedulerOptions>().Enabled =
    builder.Configuration.GetValue("FollowUp:SchedulerEnabled", true);

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();

app.UseAntiforgery();

app.MapStaticAssets();
app.MapCallEWebhook();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
