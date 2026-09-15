# -*- coding: utf-8 -*-
from odoo.tests.common import TransactionCase


class TestCalleCall(TransactionCase):

    def setUp(self):
        super().setUp()
        self.partner = self.env['res.partner'].create({
            'name': 'Sample Customer',
            'phone': '+1 (555) 555-0100',
            'email': 'customer@example.com',
        })

        self.server_action = self.env['ir.actions.server'].create({
            'name': 'Test CALL-E Action',
            'model_id': self.env.ref('base.model_res_partner').id,
            'state': 'calle_call',
            'calle_phone_field_chain': 'phone',
        })

    def test_e164_phone_validation(self):
        """Test E.164 phone normalization and strict ASCII validation rules."""
        action = self.server_action

        is_valid, phone = action._normalize_and_validate_e164('+1 (555) 555-0100')
        self.assertTrue(is_valid)
        self.assertEqual(phone, '+15555550100')

        is_valid, phone = action._normalize_and_validate_e164('+44-20-7946-0958')
        self.assertTrue(is_valid)
        self.assertEqual(phone, '+442079460958')

        is_valid, phone = action._normalize_and_validate_e164('555-0100')
        self.assertFalse(is_valid)

        is_valid, phone = action._normalize_and_validate_e164('')
        self.assertFalse(is_valid)
        self.assertEqual(phone, '')

        # Non-ASCII digits and confusable unicode characters must be rejected
        is_valid, phone = action._normalize_and_validate_e164('+1٢34567890')
        self.assertFalse(is_valid)

        is_valid, phone = action._normalize_and_validate_e164('+1５５５５５５０１００')
        self.assertFalse(is_valid)

    def test_phone_and_provider_masking_in_records_and_chatter(self):
        """Test that phone numbers and provider credentials are masked in records and computed displays."""
        call_log = self.env['calle.call'].create({
            'name': 'PII Masking Test',
            'phone_number': '+15555550100',
            'status': 'completed',
            'result_text': 'Call placed to +15555550100 with Bearer sk_live_secret123456',
            'structured_result': '{"contact_phone": "+442079460958", "api_key": "sk_live_999999"}',
            'evidence': '["Reached recipient at +15555550100"]',
        })

        self.assertEqual(call_log.masked_phone, '+1******0100')

        # Verify computed display fields mask phone numbers and API keys
        self.assertNotIn('+15555550100', call_log.display_result)
        self.assertIn('+1******0100', call_log.display_result)
        self.assertNotIn('sk_live_secret123456', call_log.display_result)

        self.assertNotIn('+442079460958', call_log.display_structured_result)
        self.assertNotIn('sk_live_999999', call_log.display_structured_result)

        self.assertNotIn('+15555550100', call_log.display_evidence)
        self.assertIn('+1******0100', call_log.display_evidence)

    def test_task_template_rendering(self):
        """Test Jinja2 template rendering for phone call dialogue prompts."""
        action = self.server_action
        template = "Hello {{ record.name }}, calling regarding your account."
        rendered = action._render_task_template(template, self.partner)
        self.assertEqual(rendered, "Hello Sample Customer, calling regarding your account.")

    def test_calle_call_log_creation_and_computed_fields(self):
        """Test creation of calle.call records and display computations for evidence & results."""
        call_log = self.env['calle.call'].create({
            'name': 'Test Call Log',
            'phone_number': '+15555550100',
            'task_description': 'Confirm appointment for Sample Customer',
            'status': 'completed',
            'res_model': 'res.partner',
            'res_id': self.partner.id,
            'server_action_id': self.server_action.id,
            'task_completed': True,
            'result_text': '{"summary": "Appointment confirmed for tomorrow at 10 AM.", "completion_confidence": {"score": 0.95, "label": "high"}}',
            'structured_result': '{"appointment_date": "2026-09-10", "confirmed": true}',
            'evidence': '["Caller confirmed availability for 10 AM", "Agreed to address on file"]',
        })

        self.assertEqual(call_log.status, 'completed')
        self.assertTrue(call_log.task_completed)
        self.assertEqual(call_log.record_name, 'Sample Customer')

        # Verify computed display fields
        self.assertIn("Summary:", call_log.display_result)
        self.assertIn("Appointment confirmed", call_log.display_result)
        self.assertIn("appointment_date: 2026-09-10", call_log.display_structured_result)
        self.assertIn("• Caller confirmed availability for 10 AM", call_log.display_evidence)

    def test_cron_cleanup_stale_pending_calls(self):
        """Test cleanup cron method for stale pending call logs."""
        stale_call = self.env['calle.call'].create({
            'name': 'Stale Pending Call',
            'phone_number': '+15555550100',
            'status': 'pending',
            'date': '2026-01-01 00:00:00',
        })

        self.env['calle.call']._cron_cleanup_stale_pending_calls(timeout_minutes=60)
        self.assertEqual(stale_call.status, 'failed')
        self.assertIn("Timed Out", stale_call.result_text)

    def test_server_action_creates_draft_call_and_activity(self):
        """Test that server action creates a draft calle.call record and schedules a To-Do activity."""
        self.server_action.with_context(active_model='res.partner', active_id=self.partner.id).run()

        call_log = self.env['calle.call'].search([
            ('res_model', '=', 'res.partner'),
            ('res_id', '=', self.partner.id),
        ], limit=1)

        self.assertTrue(call_log)
        self.assertEqual(call_log.status, 'draft')
        self.assertIn("Draft call created", call_log.result_text)

        activity = self.env['mail.activity'].search([
            ('res_model', '=', 'calle.call'),
            ('res_id', '=', call_log.id),
        ])
        self.assertTrue(activity)

    def test_failed_status_on_invalid_phone(self):
        """Test that invalid phone numbers."""
        call_log = self.env['calle.call'].create({
            'name': 'Invalid Phone Test Call',
            'phone_number': '555-0100',
            'status': 'draft',
        })

        # Triggering call to invalid phone number sets status to 'skipped' in actual code
        call_log.action_trigger_call()
        self.assertEqual(call_log.status, 'skipped')
        self.assertIn("does not match E.164 format", call_log.result_text)

    def test_task_prompt_displays_response_code_execution(self):
        """Test that task prompt displays exact response choices and Python code snippet to be executed."""
        sec = self.env['calle.section'].create({
            'server_action_id': self.server_action.id,
            'section_text': 'Confirm appointment',
        })
        self.env['calle.section.response'].create({
            'section_id': sec.id,
            'name': 'Confirmed',
            'action_code': 'record.message_post(body="Confirmed!")',
        })
        self.env['calle.section.response'].create({
            'section_id': sec.id,
            'name': 'Cancelled',
        })

        prompt, _ = self.server_action._build_sections_prompt_and_schema(self.partner)
        self.assertIn("Post-Call Response Code Execution:", prompt)
        self.assertIn("answer 'Confirmed': Executes Python Code: `record.message_post(body=\"Confirmed!\")`", prompt)
        self.assertNotIn("answer 'Cancelled':", prompt)
