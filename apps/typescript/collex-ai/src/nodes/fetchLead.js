const { leadStore } = require("../fixtures/demoStore");

const fetchLead = async (state) => {
  console.log("fetchLead node comes response");

  const lead = leadStore.get(state.leadId);
  if (!lead) throw new Error("Lead not found: " + state.leadId);
  return { leadData: lead };
};

module.exports = { fetchLead };
