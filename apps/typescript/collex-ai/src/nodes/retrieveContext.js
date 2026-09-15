const { businessStore } = require("../fixtures/demoStore");

// Standalone demo has no vector DB or ingested documents, so this is a tiny
// static knowledge base standing in for the real retrieveRelevantChunks()
const DEMO_KNOWLEDGE_BASE = {
  demo_business_001: [
    "Skyline Realty specializes in 2-4 BHK apartments in West Pune, price range 45L-1.5Cr.",
    "Site visits are available Tuesday to Sunday, 10am-6pm.",
    "Home loan assistance is available through partner banks.",
  ],
};

const retrieveContext = async (state) => {
  console.log("retrieveContext node comes (call)");

  const { leadData } = state;
  const chunks = DEMO_KNOWLEDGE_BASE[leadData.business] || [];

  console.log("retrieveContext chunks =>", chunks.length);
  return { retrievedContext: chunks };
};

module.exports = { retrieveContext };
