using System.Text.Json;
using CareCall.Core.Domain;

namespace CareCall.Web.Services;

/// <summary>
/// Translates the raw agent traces into something presentable on the dashboard.
///
/// Parsing is intentionally TOLERANT: if an agent's JSON comes back incomplete or
/// malformed, we show whatever is available instead of breaking the patient record.
/// </summary>
public static class AgentTracePresenter
{
    public static AgentStepVm ToViewModel(AgentTrace trace)
    {
        var (title, icon) = Describe(trace.Agent);

        var highlights = new List<AgentHighlight>();
        var findings = new List<string>();
        string? quote = null;
        var overridden = false;

        if (TryParse(trace.RawJson, out var root))
        {
            switch (trace.Agent)
            {
                case AgentKind.TrendAnalyst:
                    AddString(root, "trajectory", "Trajectory", highlights);
                    AddStrings(root, "progressiveFindings", findings);
                    if (GetBool(root, "gradualDeteriorationDetected"))
                        highlights.Add(new AgentHighlight("Gradual deterioration", "Detected"));
                    break;

                case AgentKind.DevilsAdvocate:
                    var challenged = GetBool(root, "challengeFound");
                    var verified = GetBool(root, "quoteVerified");
                    highlights.Add(new AgentHighlight("Challenge", challenged ? "Raised" : "None"));

                    var newRisk = GetString(root, "overriddenRisk");
                    if (challenged && !string.IsNullOrWhiteSpace(newRisk))
                    {
                        highlights.Add(new AgentHighlight("Risk raised to", newRisk!));
                        overridden = true;
                    }

                    // We only show the quote if it was verified against the transcript:
                    // an unverified quote did not influence the decision.
                    if (verified) quote = GetString(root, "supportingQuote");
                    AddStrings(root, "missedFindings", findings);
                    break;

                case AgentKind.ClinicalHandoff:
                    AddString(root, "situation", "Situation", highlights);
                    AddString(root, "background", "Background", highlights);
                    AddString(root, "assessment", "Assessment", highlights);
                    AddString(root, "recommendation", "Recommendation", highlights);
                    break;

                case AgentKind.AdaptiveScheduler:
                    if (GetBool(root, "dischargeFollowUp"))
                        highlights.Add(new AgentHighlight("Follow-up", "Complete"));
                    else if (root.TryGetProperty("nextCallInDays", out var days) &&
                             days.ValueKind == JsonValueKind.Number)
                        highlights.Add(new AgentHighlight("Next call", $"in {days.GetInt32()} day(s)"));
                    break;

                case AgentKind.QuestionPlanner:
                    AddStrings(root, "questions", findings);
                    var flags = new List<string>();
                    AddStrings(root, "redFlags", flags);
                    if (flags.Count > 0)
                        highlights.Add(new AgentHighlight("Red flags screened", string.Join(", ", flags)));
                    break;
            }
        }

        return new AgentStepVm(
            trace.Agent,
            title,
            icon,
            trace.Outcome,
            trace.Rationale,
            trace.Succeeded,
            trace.ElapsedMs,
            trace.CreatedOn,
            highlights,
            findings,
            quote,
            overridden);
    }

    private static (string Title, string Icon) Describe(AgentKind kind) => kind switch
    {
        AgentKind.QuestionPlanner => ("Question planner", "checklist"),
        AgentKind.TrendAnalyst => ("Trend analyst", "timeline"),
        AgentKind.Analyst => ("Clinical analyst", "clinical_notes"),
        AgentKind.DevilsAdvocate => ("Safety reviewer", "gavel"),
        AgentKind.ClinicalHandoff => ("Clinical handover", "assignment"),
        AgentKind.AdaptiveScheduler => ("Follow-up scheduler", "event_repeat"),
        _ => ("Agent", "smart_toy")
    };

    private static bool TryParse(string? raw, out JsonElement root)
    {
        root = default;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        try
        {
            using var doc = JsonDocument.Parse(raw);
            root = doc.RootElement.Clone();
            return root.ValueKind == JsonValueKind.Object;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static bool GetBool(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static void AddString(JsonElement root, string name, string label, List<AgentHighlight> target)
    {
        var value = GetString(root, name);
        if (!string.IsNullOrWhiteSpace(value))
            target.Add(new AgentHighlight(label, value!));
    }

    private static void AddStrings(JsonElement root, string name, List<string> target)
    {
        if (!root.TryGetProperty(name, out var array) || array.ValueKind != JsonValueKind.Array)
            return;

        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String) continue;
            var value = item.GetString();
            if (!string.IsNullOrWhiteSpace(value)) target.Add(value!);
        }
    }
}
