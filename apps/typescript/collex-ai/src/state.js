const { Annotation } = require("@langchain/langgraph");

const AgentState = Annotation.Root({
  leadId: Annotation(),
  leadData: Annotation(),
  userContext: Annotation({
    default: () => "",
    reducer: (_, next) => next,
  }), // specific instruction given by user
  retrievedContext: Annotation({
    default: () => [], //  retrieve relevant chunks form RAG (business info)
    reducer: (_, next) => next, // new value replaces old ones
  }),
  taskText: Annotation(), // it will send to CALL-E
  callResult: Annotation(),
  callStatus: Annotation(), // "completed" | "no_answer" | "failed"
  nextAction: Annotation(),
  attemptNumber: Annotation({
    default: () => 1,
    reducer: (_, next) => next,
  }),
  requestId: Annotation(), // for idempotency key
});

module.exports = { AgentState };
