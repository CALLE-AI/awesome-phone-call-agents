import ast
import json
import logging
import re
from odoo import api, fields, models, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

PHONE_E164_PATTERN = re.compile(r'\+[1-9][0-9]{6,14}')
PHONE_GROUPED_PATTERN = re.compile(r'(?<!\w)\+[1-9](?:[\s().-]*\d){6,14}(?!\d)')
CREDENTIAL_PATTERN = re.compile(r'(?:api_key|bearer|token|sk_live|secret)[\s:=]+[A-Za-z0-9_\-\.]{8,}', re.IGNORECASE)


def _mask_phone_number(phone):
    """
    Redacts subscriber digits, keeping country code / leading digit and last 4 digits for PII protection.
    `+15555550100` -> `+1******0100`. Never returns unmasked phone numbers in logs, chatter, or records.
    """
    if not phone or not isinstance(phone, str):
        return "<invalid>" if phone else "<empty>"
    val = phone.strip()
    if not val:
        return "<empty>"

    digits = [i for i, c in enumerate(val) if c.isdigit() or not c.isascii()]
    if len(digits) <= 5:
        return val[0] + "*" * (len(val) - 1) if len(val) > 1 else "*"

    keep_head, keep_tail = set(digits[:1]), set(digits[-4:])
    out = []
    for i, c in enumerate(val):
        if i in digits and i not in keep_head and i not in keep_tail:
            out.append("*")
        else:
            out.append(c)
    return "".join(out)


def _mask_phone_in_text(text):
    """
    Redacts any E.164 or international display phone numbers in free text strings.
    """
    if not text or not isinstance(text, str):
        return text
    out = PHONE_GROUPED_PATTERN.sub(lambda m: _mask_phone_number(m.group(0)), text)
    out = PHONE_E164_PATTERN.sub(lambda m: _mask_phone_number(m.group(0)), out)
    return out


def _sanitize_provider_data(err):
    """
    Sanitizes provider API keys, Bearer tokens, credentials, and phone numbers from text/error strings.
    """
    if not err:
        return ""
    err_str = str(err)
    err_str = CREDENTIAL_PATTERN.sub('[REDACTED_CREDENTIAL]', err_str)
    return _mask_phone_in_text(err_str)


def _parse_raw_dict(text):
    """Utility to attempt parsing a string as a Python dict or JSON dict."""
    if not text or not isinstance(text, str):
        return None
    s = text.strip()
    if not (s.startswith('{') and s.endswith('}')):
        return None
    try:
        val = json.loads(s)
        if isinstance(val, dict):
            return val
    except Exception:
        pass
    try:
        val = ast.literal_eval(s)
        if isinstance(val, dict):
            return val
    except Exception:
        pass
    return None


class CalleCall(models.Model):
    _name = 'calle.call'
    _description = 'CALL-E Phone Call'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'date desc, id desc'

    name = fields.Char(string="Task Summary", required=True, tracking=True)
    phone_number = fields.Char(string="Phone Number", tracking=True)
    masked_phone = fields.Char(string="Masked Phone", compute="_compute_masked_phone", store=True)
    task_description = fields.Text(string="Task Prompt")
    status = fields.Selection(
        selection=[
            ('draft', 'Draft'),
            ('pending', 'Calling'),
            ('completed', 'Completed'),
            ('failed', 'Failed'),
            ('skipped', 'Skipped'),
        ],
        string="Status",
        default='draft',
        required=True,
        index=True,
        tracking=True
    )
    locale = fields.Char(string="Locale")
    call_id = fields.Char(string="CALL-E Call ID", index=True, tracking=True)
    result_text = fields.Text(string="Result", tracking=True)
    res_model = fields.Char(string="Related Model", index=True)
    res_id = fields.Integer(string="Related Record ID", index=True)
    record_name = fields.Char(string="Record Name", compute="_compute_record_name", store=True)
    server_action_id = fields.Many2one('ir.actions.server', string="Server Action", ondelete='set null')
    date = fields.Datetime(string="Date Triggered", default=fields.Datetime.now, required=True, index=True)
    task_completed = fields.Boolean(string="Task Completed", tracking=True)
    structured_result = fields.Text(string="Structured Result (JSON)")
    evidence = fields.Text(string="Evidence")

    display_result = fields.Text(string="Formatted Result", compute="_compute_display_fields")
    display_structured_result = fields.Text(string="Formatted Structured Result", compute="_compute_display_fields")
    display_evidence = fields.Text(string="Formatted Evidence", compute="_compute_display_fields")

    @api.depends('phone_number')
    def _compute_masked_phone(self):
        for rec in self:
            rec.masked_phone = _mask_phone_number(rec.phone_number)

    @api.depends('result_text', 'structured_result', 'evidence')
    def _compute_display_fields(self):
        for rec in self:
            raw_dict = _parse_raw_dict(rec.result_text)

            # 1. Result Text
            if raw_dict:
                parts = []
                summary = raw_dict.get('summary')
                fail_code = raw_dict.get('failure_code')
                fail_msg = raw_dict.get('failure_message')
                conf = raw_dict.get('completion_confidence')

                if summary:
                    parts.append(f"Summary:\n{summary}")
                if fail_msg or fail_code:
                    f_str = f"[{fail_code}] {fail_msg}".strip() if fail_code else fail_msg
                    parts.append(f"Failure Reason:\n{f_str}")
                if isinstance(conf, dict):
                    score = conf.get('score')
                    label = conf.get('label')
                    if score is not None:
                        parts.append(f"Completion Confidence: {int(score * 100)}% ({label or ''})")

                rec.display_result = _sanitize_provider_data("\n\n".join(parts)) if parts else _sanitize_provider_data(rec.result_text)
            else:
                rec.display_result = _sanitize_provider_data(rec.result_text)

            # 2. Structured Result
            struct_val = rec.structured_result
            if not struct_val and raw_dict:
                struct_val = raw_dict.get('structured_result')

            if struct_val:
                if isinstance(struct_val, dict):
                    raw_str = "\n".join(f"{k}: {v}" for k, v in struct_val.items())
                elif isinstance(struct_val, list):
                    raw_str = json.dumps(struct_val, indent=2)
                else:
                    raw_struct_dict = _parse_raw_dict(str(struct_val))
                    if raw_struct_dict and isinstance(raw_struct_dict, dict):
                        raw_str = "\n".join(f"{k}: {v}" for k, v in raw_struct_dict.items())
                    else:
                        raw_str = str(struct_val)
                rec.display_structured_result = _sanitize_provider_data(raw_str)
            else:
                rec.display_structured_result = False

            # 3. Evidence
            ev_val = rec.evidence
            if not ev_val and raw_dict:
                ev_val = raw_dict.get('evidence')

            if ev_val:
                if isinstance(ev_val, list):
                    raw_ev = "\n".join(f"• {item}" for item in ev_val if item)
                elif isinstance(ev_val, dict):
                    raw_ev = json.dumps(ev_val, indent=2)
                else:
                    raw_ev_list = None
                    try:
                        s = str(ev_val).strip()
                        if s.startswith('[') and s.endswith(']'):
                            raw_ev_list = ast.literal_eval(s)
                    except Exception:
                        pass
                    if isinstance(raw_ev_list, list):
                        raw_ev = "\n".join(f"• {item}" for item in raw_ev_list if item)
                    else:
                        raw_ev = str(ev_val)
                rec.display_evidence = _sanitize_provider_data(raw_ev)
            else:
                rec.display_evidence = False

    @api.depends('res_model', 'res_id')
    def _compute_record_name(self):
        for log in self:
            if log.res_model and log.res_id:
                try:
                    record = self.env[log.res_model].browse(log.res_id)
                    log.record_name = record.display_name if record.exists() else f"{log.res_model},{log.res_id}"
                except Exception:
                    log.record_name = f"{log.res_model},{log.res_id}"
            else:
                log.record_name = False

    def action_trigger_call(self):
        """
        Manually triggers an outbound phone call for a draft call record.
        Validates E.164 phone formatting, destination authorization allowlist, API key configuration,
        and concurrent pending call limits before initiating the background worker thread.
        """
        import threading
        from datetime import timedelta

        server_action_model = self.env['ir.actions.server']

        for call in self:
            if call.status not in ('draft', 'failed'):
                raise UserError(_("Only draft or failed calls can be triggered."))

            # Retrieve system parameters
            api_key = self.env['ir.config_parameter'].sudo().get_param('call_e.api_key')
            timeout_param = self.env['ir.config_parameter'].sudo().get_param('call_e.pending_timeout_minutes')
            try:
                pending_timeout = int(timeout_param) if timeout_param else 30
            except Exception:
                pending_timeout = 30

            effective_locale = call.locale or self.env['ir.config_parameter'].sudo().get_param('call_e.default_locale') or 'en-US'

            # E.164 Validation Check
            raw_phone = call.phone_number or ""
            is_valid_e164, normalized_phone = server_action_model._normalize_and_validate_e164(raw_phone)
            target_phone_num = normalized_phone if is_valid_e164 else raw_phone
            masked_phone = _mask_phone_number(target_phone_num)

            if not is_valid_e164:
                skip_msg = f"Skipped: Phone number '{masked_phone}' does not match E.164 format (must start with '+' followed by country code and digits, e.g. +1234567890)."
                _logger.info("CALL-E manual call trigger skipped for log #%s: %s", call.id, skip_msg)
                call.write({
                    'status': 'skipped',
                    'result_text': skip_msg,
                })
                continue

            # Concurrent Pending Check with Timeout Expiry - Sets status to 'failed' if pending call exists
            now = fields.Datetime.now()
            timeout_threshold = now - timedelta(minutes=pending_timeout)

            stale_pending = self.sudo().search([
                ('phone_number', '=', target_phone_num),
                ('status', '=', 'pending'),
                ('date', '<', timeout_threshold)
            ])
            if stale_pending:
                stale_pending.write({
                    'status': 'failed',
                    'result_text': f"Timed Out: Pending status expired automatically after {pending_timeout} minutes."
                })

            pending_call = self.sudo().search([
                ('phone_number', '=', target_phone_num),
                ('status', '=', 'pending'),
                ('id', '!=', call.id),
                ('date', '>=', timeout_threshold)
            ], limit=1)
            if pending_call:
                fail_msg = f"Failed: A call to phone number '{masked_phone}' is already in progress (Log #{pending_call.id}, started at {pending_call.date})."
                _logger.info("CALL-E manual call trigger failed for log #%s: %s", call.id, fail_msg)
                call.write({
                    'status': 'failed',
                    'result_text': fail_msg,
                })
                continue

            if not api_key:
                err_msg = "CALL-E API Key is not configured. Please set API Key in General Settings -> CALL-E Configuration."
                _logger.error(err_msg)
                call.write({
                    'status': 'failed',
                    'result_text': err_msg,
                })
                continue

            # Mark scheduled To-Do activities on this call log as completed
            open_activities = self.env['mail.activity'].search([
                ('res_model', '=', 'calle.call'),
                ('res_id', '=', call.id),
            ])
            if open_activities:
                try:
                    open_activities.action_feedback(feedback=_("Call manually triggered by user."))
                except Exception as act_err:
                    _logger.warning("Failed to mark activity feedback on calle.call #%s: %s", call.id, act_err)

            # Update call status to pending before starting background execution thread
            call.write({
                'status': 'pending',
                'phone_number': target_phone_num,
                'result_text': "Initiating call via CALL-E SDK...",
            })

            recipient_dict = {'phone': normalized_phone}
            if effective_locale:
                recipient_dict['locale'] = effective_locale

            call_kwargs = {
                'task': call.task_description or call.name,
                'recipient': recipient_dict,
            }

            target_rec = False
            if call.res_model and call.res_id:
                try:
                    target_rec = self.env[call.res_model].browse(call.res_id)
                except Exception:
                    target_rec = False

            if call.server_action_id and target_rec and target_rec.exists():
                _, result_schema = call.server_action_id._build_sections_prompt_and_schema(target_rec)
                if result_schema and result_schema.get('properties'):
                    call_kwargs['result_schema'] = result_schema

            dbname = self.env.cr.dbname
            uid = self.env.uid

            thread = threading.Thread(
                target=server_action_model._run_call_in_background,
                args=(
                    dbname,
                    uid,
                    call.id,
                    call.server_action_id.id if call.server_action_id else False,
                    call.res_model,
                    call.res_id,
                    call.res_model,
                    call.res_id,
                    api_key,
                    call_kwargs,
                ),
                daemon=True
            )
            thread.start()

        return True


    @api.model
    def _cron_cleanup_stale_pending_calls(self, timeout_minutes=None):
        """
        Cron job / scheduled task method to automatically set any pending call logs
        older than `timeout_minutes` to 'failed' (timed out).
        """
        if timeout_minutes is None:
            param = self.env['ir.config_parameter'].sudo().get_param('call_e.pending_timeout_minutes')
            try:
                timeout_minutes = int(param) if param else 30
            except Exception:
                timeout_minutes = 30

        from datetime import timedelta
        threshold = fields.Datetime.now() - timedelta(minutes=timeout_minutes)
        stale_logs = self.search([
            ('status', '=', 'pending'),
            ('date', '<', threshold)
        ])
        if stale_logs:
            _logger.info("Cron cleanup: Marking %s stale pending call logs as failed (timeout).", len(stale_logs))
            stale_logs.write({
                'status': 'failed',
                'result_text': f"Timed Out: Call pending status expired after {timeout_minutes} minutes."
            })
        return True

