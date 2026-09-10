const { StateGraph } = require("@langchain/langgraph");
const { AgentState } = require("./state");
const { fetchLead } = require("./nodes/fetchLead");
const { retrieveContext } = require("./nodes/retrieveContext");
const { buildTask } = require("./nodes/buildTask");
const { triggerCall } = require("./nodes/triggerCall");
const {
  processResult,
  markNotInterested,
  scheduleFollowup,
  incrementAttempt,
  markHot,
} = require("./nodes/processResult");
const { decideNextStep } = require("./router");

const workflow = new StateGraph(AgentState)
  .addNode("fetchLead", fetchLead)
  .addNode("retrieveContext", retrieveContext)
  .addNode("buildTask", buildTask)
  .addNode("triggerCall", triggerCall)
  .addNode("processResult", processResult)
  .addNode("incrementAttempt", incrementAttempt)
  .addNode("markHot", markHot)
  .addNode("markNotInterested", markNotInterested)
  .addNode("scheduleFollowup", scheduleFollowup)

  .addEdge("__start__", "fetchLead")
  .addEdge("fetchLead", "retrieveContext")
  .addEdge("retrieveContext", "buildTask")
  .addEdge("buildTask", "triggerCall")
  .addEdge("triggerCall", "processResult")

  .addConditionalEdges("processResult", decideNextStep, {
    retry: "incrementAttempt",
    mark_hot: "markHot",
    mark_not_interested: "markNotInterested",
    schedule_followup: "scheduleFollowup",
    end: "__end__",
  })

  .addEdge("incrementAttempt", "triggerCall")
  .addEdge("markHot", "__end__")
  .addEdge("markNotInterested", "__end__")
  .addEdge("scheduleFollowup", "__end__");

const graph = workflow.compile();

module.exports = { graph };
