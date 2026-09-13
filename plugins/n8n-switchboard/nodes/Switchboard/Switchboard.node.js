// CALL-E Switchboard node for n8n.
//
// run_call is annotated destructiveHint:true. This node makes that annotation
// mean something: it plans the call, keeps the confirm_token, and will not
// spend it until a human approves in the Switchboard console.
const { queue, dial, follow, redact } = require('../../core/runner');
const store = require('../../core/store');
const policy = require('../../core/policy');

class Switchboard {
  constructor() {
    this.description = {
      displayName: 'CALL-E Switchboard',
      name: 'calleSwitchboard',
      icon: 'file:switchboard.svg',
      group: ['transform'],
      version: 1,
      subtitle: '={{$parameter["operation"]}}',
      description: 'Queue CALL-E phone calls behind a human approval gate',
      defaults: { name: 'CALL-E Switchboard' },
      inputs: ['main'],
      outputs: ['main'],
      properties: [
        {
          displayName: 'Operation',
          name: 'operation',
          type: 'options',
          noDataExpression: true,
          default: 'queueCall',
          options: [
            { name: 'Queue Call', value: 'queueCall', description: 'Plan a call and hold it for approval. Does not dial.' },
            { name: 'Await Result', value: 'awaitResult', description: 'Dial once approved, then poll until the call ends' },
            { name: 'Get Status', value: 'getStatus', description: 'Read a job without changing it' },
            { name: 'Cancel', value: 'cancel', description: 'Cancel a job. CALL-E has no cancel tool, so this is the only stop.' }
          ]
        },
        {
          displayName: 'What Should CALL-E Do?',
          name: 'userInput',
          type: 'string',
          typeOptions: { rows: 3 },
          default: '',
          required: true,
          displayOptions: { show: { operation: ['queueCall'] } },
          placeholder: 'Call the clinic and confirm the Friday 3pm appointment',
          description: 'Plain language goal. Passed to plan_call as user_input.'
        },
        {
          displayName: 'Recipient Phone',
          name: 'phone',
          type: 'string',
          default: '',
          required: true,
          displayOptions: { show: { operation: ['queueCall'] } },
          placeholder: '+15550101234'
        },
        {
          displayName: 'Recipient Region',
          name: 'region',
          type: 'options',
          default: 'US',
          displayOptions: { show: { operation: ['queueCall'] } },
          options: policy.SUPPORTED_REGIONS.map(r => ({ name: r, value: r })),
          description: 'CALL-E supports a fixed region list. Anything else is refused before dialing.'
        },
        {
          displayName: 'Mode',
          name: 'mode',
          type: 'options',
          default: 'require_approval',
          displayOptions: { show: { operation: ['queueCall'] } },
          options: [
            { name: 'Require Approval', value: 'require_approval', description: 'Default. A human must approve in the console.' },
            { name: 'Dry Run', value: 'dry_run', description: 'Build the payload and show it. Never contacts CALL-E.' },
            { name: 'Auto', value: 'auto', description: 'No human gate. Policy checks still apply. Use deliberately.' }
          ]
        },
        {
          displayName: 'Timezone',
          name: 'timezone',
          type: 'string',
          default: 'UTC',
          displayOptions: { show: { operation: ['queueCall'] } },
          description: 'IANA timezone passed to plan_call as planning metadata'
        },
        {
          displayName: 'Result Schema',
          name: 'resultSchema',
          type: 'json',
          default: '{}',
          displayOptions: { show: { operation: ['queueCall'] } },
          description: 'JSON schema checked against result.extracted when the call ends'
        },
        {
          displayName: 'Job ID',
          name: 'jobId',
          type: 'string',
          default: '={{ $json.jobId }}',
          required: true,
          displayOptions: { show: { operation: ['awaitResult', 'getStatus', 'cancel'] } }
        },
        {
          displayName: 'Approval Timeout (Minutes)',
          name: 'approvalTimeout',
          type: 'number',
          default: 30,
          displayOptions: { show: { operation: ['awaitResult'] } },
          description: 'How long to wait for a human before giving up'
        }
      ]
    };
  }

  async execute() {
    const items = this.getInputData();
    const out = [];

    for (let i = 0; i < items.length; i++) {
      const operation = this.getNodeParameter('operation', i);

      if (operation === 'queueCall') {
        let resultSchema = this.getNodeParameter('resultSchema', i);
        if (typeof resultSchema === 'string') {
          try { resultSchema = JSON.parse(resultSchema); } catch { resultSchema = null; }
        }
        if (resultSchema && Object.keys(resultSchema).length === 0) resultSchema = null;

        const job = await queue({
          userInput: this.getNodeParameter('userInput', i),
          recipient: {
            phone: this.getNodeParameter('phone', i),
            region: this.getNodeParameter('region', i)
          },
          resultSchema,
          mode: this.getNodeParameter('mode', i),
          timezone: this.getNodeParameter('timezone', i)
        });

        out.push({ json: { jobId: job.id, ...redact(job) } });
        continue;
      }

      const jobId = this.getNodeParameter('jobId', i);

      if (operation === 'getStatus') {
        out.push({ json: redact(store.getJob(jobId)) });
        continue;
      }

      if (operation === 'cancel') {
        const job = store.updateJob(jobId, { status: 'cancelled', confirmToken: null }, 'cancelled', 'workflow');
        out.push({ json: redact(job) });
        continue;
      }

      if (operation === 'awaitResult') {
        const timeoutMs = this.getNodeParameter('approvalTimeout', i) * 60 * 1000;
        const started = Date.now();
        let job = store.getJob(jobId);
        if (!job) throw new Error('No such job: ' + jobId);

        // Wait for a human. This is the whole point of the node.
        while (job.status === 'pending' && Date.now() - started < timeoutMs) {
          await new Promise(r => setTimeout(r, 2000));
          job = store.getJob(jobId);
        }

        if (job.status === 'pending') {
          out.push({ json: { ...redact(job), timedOutAwaitingApproval: true } });
          continue;
        }
        if (['rejected', 'cancelled', 'dry_run'].includes(job.status)) {
          out.push({ json: redact(job) });
          continue;
        }

        if (job.status === 'approved') job = await dial(jobId, 'workflow');
        if (job.status === 'dialing' && job.callRunId) job = await follow(jobId);

        out.push({ json: redact(job) });
      }
    }

    return [out];
  }
}

module.exports = { Switchboard };
