using System.Text;

namespace CareCall.Core.Agents;

/// <summary>
/// Generates the specific questions CALL-E will ask during the call, personalized
/// based on the diagnosis and what was left open in previous calls.
///
/// It is the only agent that runs BEFORE the call and the only one that changes
/// what the patient hears: if in the previous call they said they had stopped their
/// medication, the next one should start there.
/// </summary>
public class QuestionPlannerAgent(AgentRunner runner) : IQuestionPlannerAgent
{
    private const string SystemPrompt = """
        You are a clinical follow-up planner. Prepare the questions an automated voice
        assistant will ask a patient recently discharged from the emergency department.

        Reply ONLY with a valid JSON object, no extra text and no code fences:

        {
          "questions": ["question to ask the patient", "..."],
          "followUpPoints": ["issue left open in the previous call to re-check", "..."],
          "redFlags": ["warning sign to screen for, specific to this diagnosis", "..."],
          "rationale": "1-2 sentences on why these questions were chosen"
        }

        Rules:
        - Produce between 4 and 6 questions, ordered by clinical priority.
        - The patient may be elderly: use short, plain, everyday language. One idea per
          question. No medical jargon, no compound questions.
        - Tailor the questions to the specific diagnosis. Generic questions like
          "how are you?" are only acceptable as an opening.
        - If there are previous calls, the FIRST questions must re-check what was left
          unresolved (unfinished medication, symptoms that were worsening, missed
          instructions). Do not repeat questions that were already clearly answered
          and resolved.
        - "redFlags" are warning signs specific to this diagnosis that require urgent
          care; they guide the screening, they are not read out to the patient.
        - Never ask anything that implies a diagnosis or a treatment change.
        - Write in English.
        """;

    public Task<AgentRun<QuestionPlanDto>> PlanAsync(AgentContext context, CancellationToken ct = default)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Patient: {context.Patient.Name}, {context.Patient.Age} years old");
        sb.AppendLine($"Discharge diagnosis: {context.Patient.Diagnosis}");
        sb.AppendLine($"Discharged on: {context.Patient.DischargeDate:yyyy-MM-dd} " +
                      $"({(DateTime.UtcNow - context.Patient.DischargeDate).Days} days ago)");
        sb.AppendLine($"Risk level on discharge: {context.Patient.RiskLevel}");
        sb.AppendLine($"This will be follow-up call number {context.CallNumber}.");

        if (context.History.Count == 0)
        {
            sb.AppendLine();
            sb.AppendLine("This is the first follow-up call: there is no previous history.");
        }
        else
        {
            sb.AppendLine();
            sb.AppendLine("Previous calls, oldest first:");
            foreach (var h in context.History)
            {
                sb.AppendLine();
                sb.AppendLine($"  {h.When:yyyy-MM-dd} - outcome: {h.Outcome}, risk: {h.Risk}");
                sb.AppendLine($"    Symptoms: {(h.Symptoms.Count == 0 ? "(none recorded)" : string.Join(", ", h.Symptoms))}");
                sb.AppendLine($"    Summary: {h.Summary}");
            }
        }

        return runner.RunAsync<QuestionPlanDto>(
            nameof(QuestionPlannerAgent), SystemPrompt, sb.ToString(), ct);
    }
}
