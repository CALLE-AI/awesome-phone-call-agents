const { Annotation } = require("@langchain/langgraph");

const AgentState = Annotation.Root({
  leadId: Annotation(),
  leadData: Annotation(),
  userContext: Annotation({
    default: () => "",
    reducer: (_, next) => next,
  }), // user ne jo specific instruction di
  retrievedContext: Annotation({
    default: () => [], //  RAG se aaye relevant chunks (business info)
    reducer: (_, next) => next, // naya value purane ko replace karega
  }),
  taskText: Annotation(), // jo CALL-E ko dena hai
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
