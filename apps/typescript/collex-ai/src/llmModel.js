const { ChatGroq } = require("@langchain/groq");

let cachedModel = null;

const getModel = async () => {
  if (cachedModel) return cachedModel;

  cachedModel = new ChatGroq({
    model: "openai/gpt-oss-120b",
    temperature: 0.3,
    // maxTokens: undefined,
    maxRetries: 2,
  });

  return cachedModel;
};

module.exports = { getModel };
