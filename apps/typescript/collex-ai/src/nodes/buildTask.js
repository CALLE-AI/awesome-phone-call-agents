const { getModel } = require("../llmModel");
const { businessStore } = require("../fixtures/demoStore");

const buildTask = async (state) => {
  console.log("buildTask node comes");
  const { leadData, retrievedContext = [], userContext } = state;

  if (!leadData?.phone) {
    throw new Error(
      `Lead ${leadData?._id} has no phone number — cannot build call task`,
    );
  }

  const business = businessStore.get(leadData.business) || {
    name: "Demo Business",
    type: "general",
  };

  // Deterministic, no-AI fallback — always valid, used whenever no LLM is available.
  const fallbackTask =
    `Call ${leadData.phone} and introduce yourself as calling from ${business.name}, ` +
    `then ask about ${leadData.name ? `${leadData.name}'s` : "their"} requirement` +
    `${leadData.notes ? ` (they mentioned: ${leadData.notes})` : ""}, ` +
    `find out their budget if it comes up naturally, and confirm if they'd like a follow-up.`;

  let model = null;
  try {
    model = await getModel(); // needs GROQ_API_KEY — may return null or throw if missing
  } catch (err) {
    console.log("buildTask: getModel() failed, no LLM available —", err.message);
  }

  if (!model) {
    console.log("buildTask: no LLM configured, using fallback task text");
    return { taskText: fallbackTask };
  }

  const prompt = `You are writing call instructions for an AI calling agent representing ${business.name}${
    business.type ? `, a ${business.type} business` : ""
  }.
  
  Recipient phone number (E.164 format, MUST be included exactly as given): ${leadData.phone}
  Lead name: ${leadData.name}
  Lead notes: ${leadData.notes || "none"}
  Business context: ${retrievedContext.join("\n") || "none"}
  ${userContext ? `\nSpecific instruction from the business owner for THIS call (high priority — follow this closely): ${userContext}\n` : ""}
  
  Write a short, natural "task" instruction (2-3 sentences) telling the calling agent
  who to call and what to say/ask. ${userContext ? "Incorporate the business owner's specific instruction, while staying consistent with the business context." : "Focus on qualifying interest and confirming a next step."}
  
  The agent should naturally try to learn: what the lead is looking for, their budget or
  spending capacity (if it comes up naturally — don't interrogate), and how soon they want
  to move forward. This helps score the lead accurately afterward.
  
  MANDATORY — the task text MUST explicitly instruct the agent to introduce itself as
  calling on behalf of "${business.name}". Never omit this, even when a specific
  instruction is given above — the caller must always state who they're calling from.
  
  If the business context doesn't have specific info the lead might ask about, instruct the
  agent to acknowledge that naturally and offer to have a team member follow up with details,
  rather than making anything up.
  
  The instruction MUST start with:
  "Call ${leadData.phone} and introduce yourself as calling from ${business.name}, then ..."
  Return ONLY the task text, nothing else.`;

  try {
    const response = await model.invoke(prompt);

    if (!response?.content?.includes(leadData.phone)) {
      console.log(
        "buildTask: LLM output missing phone number, using fallback task text instead",
      );
      return { taskText: fallbackTask };
    }

    console.log("buildTask response =>", response.content);
    return { taskText: response.content };
  } catch (err) {
    console.log("buildTask: LLM call failed, using fallback task text —", err.message);
    return { taskText: fallbackTask };
  }
};

module.exports = { buildTask };
