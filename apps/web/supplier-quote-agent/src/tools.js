const { invoke } = require('./invoke');

// Appended verbatim to every tool's description (asserted by tests/approval-gate.test.js)
// so an agent reading any single tool description — not just plan_call/place_call — sees
// the thesis stated: approval is owner-only, and it is nobody's registered tool.
const OWNER_ONLY_CLAUSE =
  'Approve and Reject are owner-only dashboard actions; no registered tool, including this one, can move a task to "approved" or "rejected".';

const tools = [
  {
    name: 'plan_call',
    description:
      'Store a call plan brief (goal, script points, success criteria, fallback) on a task, visible on the task card before any dial happens. Does NOT: approve the task, place the call, or set anything other than the plan and a "planned" status. ' +
      OWNER_ONLY_CLAUSE,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task to attach the plan to'
        },
        goal: {
          type: 'string',
          description: 'What the call should accomplish, in one sentence'
        },
        script_points: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ordered list of points the agent should raise on the call'
        },
        success_criteria: {
          type: 'string',
          description: 'What must be captured for the call to count as successful'
        },
        fallback: {
          type: 'string',
          description: 'What to do if the primary goal cannot be met (e.g. leave a voicemail)'
        }
      },
      required: ['id', 'goal']
    },
    async execute(input, actor = 'agent') {
      return await invoke('plan_call', input, actor);
    }
  },
  {
    name: 'place_call',
    description:
      'Hand a task whose status is already "approved" to the call provider — which provider dials is an operator setting (CALL_PROVIDER at process start: a deterministic fake by default, the real CALL-E integration only when explicitly configured), never a per-call choice — and dial the supplier, recording the outcome as {outcome, summary, next_action} on the task. Does NOT: approve a task itself, retry automatically on failure, choose or reconfigure the provider, or act on a task that is not yet approved — it refuses those and says to ask the owner instead of dialing. ' +
      OWNER_ONLY_CLAUSE,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the approved task to dial'
        },
        scenario: {
          type: 'string',
          description: 'Fake-provider only: which canned response to return (e.g. "default", "no_answer", "voicemail")'
        }
      },
      required: ['id']
    },
    async execute(input, actor = 'agent') {
      return await invoke('place_call', input, actor);
    }
  },
  {
    name: 'cancel_call',
    description:
      'Abort a call that is currently in flight (dialing, connected, or wrapping up) for an approved task. Against the fake provider this genuinely ends the call and marks the task "cancelled"; against the real CALL-E integration, which has no client cancel operation, it only stops this app waiting and marks the task "cancel_requested" — the phone call itself may still be ringing or connecting. Does NOT: approve, reject, or retry a task, and does NOT no-op-succeed when nothing is dialing — it refuses instead. ' +
      OWNER_ONLY_CLAUSE,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task whose in-flight call should be cancelled'
        }
      },
      required: ['id']
    },
    async execute(input, actor = 'agent') {
      return await invoke('cancel_call', input, actor);
    }
  },
  {
    name: 'retry_with_plan',
    description:
      'Replace the plan on a task that already completed, failed, was cancelled, or was rejected, and reset its status back to "planned" for a fresh attempt. Does NOT: approve the task — a "planned" task still requires the owner to approve it again before place_call will dial it, and retry_with_plan can never move a task to "approved" on its own. ' +
      OWNER_ONLY_CLAUSE,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task to re-plan'
        },
        goal: {
          type: 'string',
          description: 'Revised goal for the retry'
        },
        script_points: {
          type: 'array',
          items: { type: 'string' },
          description: 'Revised ordered list of points the agent should raise on the call'
        },
        success_criteria: {
          type: 'string',
          description: 'Revised definition of a successful call'
        },
        fallback: {
          type: 'string',
          description: 'Revised fallback if the primary goal cannot be met'
        }
      },
      required: ['id', 'goal']
    },
    async execute(input, actor = 'agent') {
      return await invoke('retry_with_plan', input, actor);
    }
  },
  {
    name: 'get_task',
    description:
      'Read a single task by id: its plan, status (pending/planned/approved/completed/failed/cancelled/cancel_requested/rejected), in-flight call stage, and outcome if it has one. Does NOT: change the task in any way — this is a read-only lookup. ' +
      OWNER_ONLY_CLAUSE,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task to read'
        }
      },
      required: ['id']
    },
    async execute(input, actor = 'agent') {
      return await invoke('get_task', input, actor);
    }
  },
  {
    name: 'list_tasks',
    description:
      'List every task with its current status and plan, so the agent can see which tasks are awaiting owner approval versus already dialed. Does NOT: change any task — this is a read-only listing. ' +
      OWNER_ONLY_CLAUSE,
    inputSchema: {
      type: 'object',
      properties: {}
    },
    async execute(input, actor = 'agent') {
      return await invoke('list_tasks', input, actor);
    }
  },
  {
    name: 'get_quote_status',
    description:
      'Retrieve call status (pending/completed/failed), partial transcript, and current result schema match confidence. Supports polling for async calls. Does NOT: Predict pricing, suggest vendors, or provide procurement advice. ' +
      OWNER_ONLY_CLAUSE,
    inputSchema: {
      type: 'object',
      properties: {
        quote_id: {
          type: 'string',
          description: 'ID of the quote to check'
        }
      },
      required: ['quote_id']
    },
    async execute(input, actor = 'agent') {
      return await invoke('get_quote_status', input, actor);
    }
  },
  {
    name: 'list_pending_quotes',
    description:
      'Return list of suppliers still pending callback, sorted by deadline. Surfaces call plan briefs authored by the user. Does NOT: Auto-retry failed calls or modify pending quote requests. ' +
      OWNER_ONLY_CLAUSE,
    inputSchema: {
      type: 'object',
      properties: {}
    },
    async execute(input, actor = 'agent') {
      return await invoke('list_pending_quotes', input, actor);
    }
  },
  {
    name: 'request_human_approval',
    description:
      'Surface the top quotes plus full call transcripts so the owner has what they need to decide. Does NOT: Make purchase decisions, contact suppliers, commit budget, or itself approve/reject anything — it only gathers what a human needs to look at. ' +
      OWNER_ONLY_CLAUSE,
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of top quotes to surface (default 3)'
        }
      }
    },
    async execute(input, actor = 'agent') {
      return await invoke('request_human_approval', input, actor);
    }
  }
];

module.exports = {
  tools,
  OWNER_ONLY_CLAUSE,
  getToolByName(name) {
    return tools.find(t => t.name === name);
  },
  getAllTools() {
    return tools;
  }
};
