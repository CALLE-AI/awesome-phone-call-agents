import type { Workflow } from "@/types/workflow";

/**
 * Stand-in for the generator's output until /api/workflows/generate exists.
 * The wealth-management lead qualification vertical — our primary demo.
 */
export const SAMPLE_WORKFLOW: Workflow = {
  id: "w1",
  name: "Wealth Management Qualification",
  goal: "Qualify inbound wealth-management enquiries on goals, horizon and risk tolerance, then book an advisor consultation.",
  nodes: [
    {
      id: "n1",
      type: "start",
      x: 60,
      y: 40,
      label: "Introduce AI + Company",
      say: "Hi, this is Ava calling from Northbridge Wealth. I am an AI assistant — I am following up on the wealth management information you requested.",
      captures: ["identity_confirmed"],
    },
    {
      id: "n2",
      type: "question",
      x: 60,
      y: 168,
      label: "Ask permission to continue",
      say: "Do you have two minutes to talk through what you are looking for?",
      captures: ["consent"],
    },
    {
      id: "n3",
      type: "question",
      x: 60,
      y: 296,
      label: "Financial Goal?",
      say: "What are you hoping this money does for you — growth, income, or protecting what you have?",
      captures: ["primary_goal"],
    },
    {
      id: "n4",
      type: "question",
      x: 60,
      y: 424,
      label: "Investment Horizon",
      say: "Roughly how long before you would need to draw on it?",
      captures: ["horizon_years"],
    },
    {
      id: "n5",
      type: "question",
      x: 60,
      y: 552,
      label: "Risk Tolerance",
      say: "If the portfolio dropped ten percent in a quarter, would you hold, add, or move to something safer?",
      captures: ["risk_profile"],
    },
    {
      id: "n6",
      type: "decision",
      x: 420,
      y: 552,
      label: "Qualification",
      say: "Score the lead on investable assets, horizon and risk fit against the advisor threshold.",
      captures: ["qualified", "score"],
    },
    {
      id: "n7",
      type: "terminal",
      x: 760,
      y: 476,
      label: "Book Advisor",
      say: "I can put you in with one of our advisors. Does Thursday morning or Friday afternoon suit you better?",
      captures: ["slot_booked"],
    },
    {
      id: "n8",
      type: "terminal",
      x: 760,
      y: 610,
      label: "Send Info",
      say: "No problem — I will email our overview so you have it when the timing is better.",
      captures: ["email_sent"],
    },
  ],
  edges: [
    { id: "e1", from: "n1", to: "n2", condition: null },
    { id: "e2", from: "n2", to: "n3", condition: "Yes" },
    { id: "e3", from: "n2", to: "n8", condition: "No" },
    { id: "e4", from: "n3", to: "n4", condition: null },
    { id: "e5", from: "n4", to: "n5", condition: null },
    { id: "e6", from: "n5", to: "n6", condition: null },
    { id: "e7", from: "n6", to: "n7", condition: "Qualified" },
    { id: "e8", from: "n6", to: "n8", condition: "Not Ready" },
  ],
  qualification: {
    threshold: 3,
    rules: [
      { field: "consent", operator: "eq", value: "yes", points: 1 },
      { field: "horizon_years", operator: "gte", value: 5, points: 2 },
      { field: "risk_profile", operator: "in", value: ["balanced", "growth"], points: 2 },
    ],
  },
  outcomeSchema: {
    fields: [
      { name: "qualified", type: "boolean", description: "Met the advisor threshold" },
      { name: "primary_goal", type: "string", description: "Growth, income or protection" },
      { name: "horizon_years", type: "number" },
      { name: "risk_profile", type: "string" },
      { name: "slot_booked", type: "boolean" },
    ],
    nextStep: ["book_advisor", "send_info", "retry", "do_not_contact"],
  },
};
