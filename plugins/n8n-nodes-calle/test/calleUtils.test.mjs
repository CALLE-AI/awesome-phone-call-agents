import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	assertValidE164PhoneNumber,
	buildCreateCallBody,
	isTerminalCallStatus,
	maskPhoneNumber,
	parseJsonObject,
} from '../dist/nodes/Calle/shared/utils.js';

describe('CALL-E utility helpers', () => {
	it('accepts valid E.164 phone numbers and rejects local formats', () => {
		assert.equal(assertValidE164PhoneNumber('+14155550100'), '+14155550100');
		assert.throws(() => assertValidE164PhoneNumber('4155550100'), /E\.164/);
		assert.throws(() => assertValidE164PhoneNumber('+1 415 555 0100'), /E\.164/);
	});

	it('parses optional JSON object parameters', () => {
		assert.deepEqual(parseJsonObject('', 'Metadata'), undefined);
		assert.deepEqual(parseJsonObject('{"workflow_run_id":"wf_123"}', 'Metadata'), {
			workflow_run_id: 'wf_123',
		});
		assert.throws(() => parseJsonObject('[]', 'Metadata'), /JSON object/);
	});

	it('builds a CALL-E create call body with recipient, schemas, metadata, and webhook URL', () => {
		assert.deepEqual(
			buildCreateCallBody({
				task: 'Call the recipient to confirm appointment details.',
				phoneNumber: '+14155550100',
				locale: 'en-US',
				region: 'US',
				metadata: { workflow_run_id: 'wf_123' },
				resultSchema: {
					type: 'object',
					required: ['completed_count'],
					properties: { completed_count: { type: 'integer' } },
				},
				recipientResultSchema: {
					type: 'object',
					required: ['confirmed'],
					properties: { confirmed: { type: 'boolean' } },
				},
				webhookUrl: 'https://example.com/calle/webhook',
			}),
			{
				task: 'Call the recipient to confirm appointment details.',
				recipients: [{ phones: ['+14155550100'], locale: 'en-US', region: 'US' }],
				metadata: { workflow_run_id: 'wf_123' },
				result_schema: {
					type: 'object',
					required: ['completed_count'],
					properties: { completed_count: { type: 'integer' } },
				},
				recipient_result_schema: {
					type: 'object',
					required: ['confirmed'],
					properties: { confirmed: { type: 'boolean' } },
				},
				webhook_url: 'https://example.com/calle/webhook',
			},
		);
	});

	it('detects terminal call statuses', () => {
		assert.equal(isTerminalCallStatus('completed'), true);
		assert.equal(isTerminalCallStatus('failed'), true);
		assert.equal(isTerminalCallStatus('canceled'), true);
		assert.equal(isTerminalCallStatus('queued'), false);
	});

	it('masks phone numbers for errors and summaries', () => {
		assert.equal(maskPhoneNumber('+14155550100'), '+1415***0100');
		assert.equal(maskPhoneNumber('1234'), '***');
	});
});
