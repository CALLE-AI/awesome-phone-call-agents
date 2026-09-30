const rawLeads = require("./sample-leads.json");

// Leads
const leadStore = new Map(
  rawLeads.map((l) => [
    l._id,
    {
      ...l,
      status: l.status || "new",
      call_attempts: 0,
      notes: l.notes || "",
      follow_up_date: null,
    },
  ]),
);

// Businesses
const businessStore = new Map([
  [
    "demo_business_001",
    {
      _id: "demo_business_001",
      name: "Skyline Realty",
      type: "real estate",
      call_balance: 100,
    },
  ],
]);

// Activity / call history logs
const activityLog = [];
const callHistoryLog = [];

module.exports = { leadStore, businessStore, activityLog, callHistoryLog };
