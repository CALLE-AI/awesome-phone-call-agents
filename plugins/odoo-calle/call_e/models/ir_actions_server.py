from datetime import timedelta
import json
import logging
import re
import requests
import threading
import time
import odoo
from odoo.modules.registry import Registry
from odoo import api, fields, models, _
from odoo.exceptions import UserError
from odoo.tools.safe_eval import safe_eval

_logger = logging.getLogger(__name__)

# Strict ASCII E.164 Regex Pattern: + followed by 1-9 and 6 to 14 ASCII digits (7 to 15 total digits)
E164_REGEX = re.compile(r'^\+[1-9][0-9]{6,14}$')
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


def _sanitize_provider_error(err):
    """
    Sanitizes provider API keys, Bearer tokens, credentials, and phone numbers from text/error strings.
    """
    if not err:
        return ""
    err_str = str(err)
    err_str = CREDENTIAL_PATTERN.sub('[REDACTED_CREDENTIAL]', err_str)
    return _mask_phone_in_text(err_str)


class IrActionsServer(models.Model):
    _inherit = 'ir.actions.server'

    state = fields.Selection(
        selection_add=[('calle_call', 'Trigger CALL-E Phone Call')],
        ondelete={'calle_call': 'cascade'}
    )
    calle_phone_field_chain = fields.Char(
        string="Phone Field",
        help="Select the phone field or nested field path (e.g. Partner > Mobile)"
    )
    calle_section_ids = fields.One2many(
        'calle.section',
        'server_action_id',
        string="Call Sections",
        copy=True
    )


    def _normalize_and_validate_e164(self, raw_phone):
        """
        Strips common formatting characters (spaces, hyphens, dots, parentheses).
        Checks if the result matches strict ASCII E.164 standard (+ followed by country code and subscriber number).
        Returns (is_valid, normalized_phone_str).
        """
        if not raw_phone:
            return False, ""

        raw_str = str(raw_phone).strip()
        if not raw_str.isascii():
            return False, raw_str

        # Remove spaces, hyphens, dots, parentheses
        cleaned = re.sub(r'[\s\-\.\(\)]', '', raw_str)

        if E164_REGEX.match(cleaned):
            return True, cleaned
        return False, cleaned

    def _render_task_template(self, template_str, record):
        """
        Renders template using Jinja2 if available, or simple string format fallback.
        """
        if not template_str:
            return ""
        try:
            from jinja2 import Template
            template = Template(template_str)
            return template.render(
                record=record,
                object=record,
                env=self.env,
                user=self.env.user
            )
        except Exception as e:
            _logger.warning("Failed to render CALL-E task template with Jinja2: %s", e)
            return template_str

    def _get_record_phones_and_targets(self, record):
        """
        Traverses calle_phone_field_chain on record.
        Handles both single fields (e.g. 'phone') and relational list fields (e.g. 'child_ids.phone').
        Returns a list of tuples: [(target_record, phone_number_str), ...]
        """
        if not self.calle_phone_field_chain:
            return [(record, "")]

        parts = self.calle_phone_field_chain.split('.')
        parent_path = parts[:-1]
        phone_field = parts[-1]

        targets = [record]
        for attr in parent_path:
            next_targets = []
            for target in targets:
                if target and hasattr(target, attr):
                    val = getattr(target, attr)
                    if isinstance(val, models.BaseModel):
                        next_targets.extend(list(val))
                    elif val:
                        next_targets.append(val)
            targets = next_targets

        results = []
        for target in targets:
            if isinstance(target, models.BaseModel):
                if hasattr(target, phone_field):
                    p_val = getattr(target, phone_field)
                    if p_val:
                        results.append((target, str(p_val).strip()))
            elif isinstance(target, dict) and phone_field in target:
                results.append((record, str(target[phone_field]).strip()))

        return results if results else [(record, "")]

    def _build_sections_prompt_and_schema(self, record):
        """
        Builds a combined prompt string and result_schema dict from calle_section_ids,
        including nested follow-up sections for confirmed responses and noting response code execution.
        """
        prompt_lines = ["Call Instructions and Dialogue Flow:"]
        properties = {}
        required_keys = []
        code_action_lines = []

        def process_section(sec, sec_key, depth=1, parent_cond=""):
            rendered_text = self._render_task_template(sec.section_text, record)
            indent = "  " * (depth - 1)

            cond_str = parent_cond

            if sec.response_ids:
                choices = [r.name for r in sec.response_ids]
                choices_str = ", ".join(f"'{c}'" for c in choices)
                prompt_lines.append(f"{indent}- Section ({sec_key}){cond_str}: {rendered_text} (Expected Answers: {choices_str})")
                properties[sec_key] = {
                    "type": "string",
                    "enum": choices,
                    "description": rendered_text
                }
                for resp in sec.response_ids:
                    if resp.action_code and resp.action_code.strip():
                        code = resp.action_code.strip()
                        if '\n' in code:
                            indented_code = "\n".join("      " + line for line in code.splitlines())
                            code_action_lines.append(f"  - Section ({sec_key}) answer '{resp.name}': Executes Python Code:\n{indented_code}")
                        else:
                            code_action_lines.append(f"  - Section ({sec_key}) answer '{resp.name}': Executes Python Code: `{code}`")
            else:
                prompt_lines.append(f"{indent}- Section ({sec_key}){cond_str}: {rendered_text}")
                properties[sec_key] = {
                    "type": "string",
                    "description": rendered_text
                }

            if depth == 1 and not cond_str:
                required_keys.append(sec_key)

            # Traverse child follow-up sections under each expected response
            for r_idx, resp in enumerate(sec.response_ids, 1):
                if resp.child_section_ids:
                    children = resp.child_section_ids.sorted(key=lambda cs: cs.id)
                    for c_idx, child in enumerate(children, 1):
                        child_key = f"{sec_key}_r{r_idx}_s{c_idx}"
                        c_cond = f" [Condition: Only ask if answer to '{sec_key}' is '{resp.name}']"
                        process_section(child, child_key, depth=depth+1, parent_cond=c_cond)

        top_sections = self.calle_section_ids.sorted(key=lambda s: s.id)
        for idx, sec in enumerate(top_sections, 1):
            sec_key = f"s_{idx}"
            process_section(sec, sec_key)

        if code_action_lines:
            prompt_lines.append("\nPost-Call Response Code Execution:")
            prompt_lines.extend(code_action_lines)

        full_prompt = "\n".join(prompt_lines)
        schema = {}
        if properties:
            schema = {
                "type": "object",
                "properties": properties,
                "required": required_keys
            }
        return full_prompt, schema

    def _run_action_calle_call(self, eval_context=None):
        """
        Main execution handler for calle_call.
        Creates draft calle.call records and schedules a To-Do activity for the user to trigger the call manually.
        """
        eval_context = eval_context or {}
        records = eval_context.get('records') or eval_context.get('record')
        if not records and eval_context.get('active_id'):
            model_name = self.model_id.model
            records = self.env[model_name].browse(eval_context.get('active_ids') or [eval_context.get('active_id')])
        
        if not records:
            _logger.info("CALL-E Action '%s': No target records found.", self.name)
            return False

        effective_locale = self.env['ir.config_parameter'].sudo().get_param('call_e.default_locale') or 'en-US'
        todo_type = self.env.ref('mail.mail_activity_data_todo', raise_if_not_found=False)

        for record in records:
            phones_and_targets = self._get_record_phones_and_targets(record)

            for target_rec, raw_phone in phones_and_targets:
                target_display_name = target_rec.display_name if (target_rec and hasattr(target_rec, 'display_name') and target_rec.display_name) else record.display_name
                is_valid_e164, normalized_phone = self._normalize_and_validate_e164(raw_phone)
                
                rendered_prompt, result_schema = self._build_sections_prompt_and_schema(target_rec)
                masked_phone = _mask_phone_number(normalized_phone if is_valid_e164 else raw_phone)

                # Create call record in DRAFT status
                call_log = self.env['calle.call'].sudo().create({
                    'name': f"Call to ({target_display_name})",
                    'phone_number': normalized_phone if is_valid_e164 else raw_phone,
                    'task_description': _mask_phone_in_text(rendered_prompt),
                    'locale': effective_locale,
                    'status': 'draft',
                    'result_text': "Draft call created. Pending manual user trigger.",
                    'res_model': target_rec._name if target_rec else record._name,
                    'res_id': target_rec.id if target_rec else record.id,
                    'server_action_id': self.id,
                })

                # Schedule a To-Do activity for the user to review and trigger the call
                if todo_type:
                    try:
                        call_log.activity_schedule(
                            activity_type_id=todo_type.id,
                            summary=_("Trigger CALL-E Phone Call: %s") % target_display_name,
                            note=_("Draft phone call staged for %s (%s). Please review and trigger the call manually.") % (target_display_name, masked_phone),
                            user_id=self.env.uid or self.env.user.id,
                        )
                    except Exception as act_err:
                        _logger.warning("Failed to schedule todo activity on calle.call #%s: %s", call_log.id, act_err)

                chatter_body = _sanitize_provider_error(
                    f"Draft CALL-E Phone Call staged for {target_display_name} ({masked_phone}). Pending manual user trigger."
                )
                try:
                    if target_rec and hasattr(target_rec, 'message_post'):
                        target_rec.message_post(body=chatter_body)
                except Exception as post_err:
                    _logger.warning("Failed to post draft message to chatter: %s", _sanitize_provider_error(post_err))

        return False

    @api.model
    def _run_call_in_background(self, dbname, uid, call_log_id, server_action_id, rule_rec_model, rule_rec_id, target_rec_model, target_rec_id, api_key, call_kwargs):
        """
        Executes the CALL-E SDK create_and_wait request in a background thread.
        Creates its own database cursor and environment context.
        """
        with Registry(dbname).cursor() as new_cr:
            new_env = api.Environment(new_cr, uid, {})
            call_log = new_env['calle.call'].browse(call_log_id)
            server_action = new_env['ir.actions.server'].browse(server_action_id) if server_action_id else False
            rule_rec = new_env[rule_rec_model].browse(rule_rec_id) if (rule_rec_model and rule_rec_id) else False
            target_rec = new_env[target_rec_model].browse(target_rec_id) if (target_rec_model and target_rec_id) else False

            status = 'failed'
            result_text = ""
            call_id = False
            task_completed = False
            structured_result_val = None
            evidence_val = None

            try:
                from calle import CalleClient
                client = CalleClient(api_key=api_key)

                # Attempt call creation exactly ONCE. Blind retries on call creation are strictly forbidden to prevent duplicate dials.
                call_res = client.calls.create_and_wait(**call_kwargs)

                if isinstance(call_res, dict):
                    res_status = call_res.get('status')
                    call_id = str(call_res.get('id', ''))
                    task_completed = bool(call_res.get('task_completed', False))
                    structured_result_val = call_res.get('structured_result')
                    evidence_val = call_res.get('evidence')
                    summary_val = call_res.get('summary') or ""
                    fail_code = call_res.get('failure_code') or ""
                    fail_msg = call_res.get('failure_message') or ""
                    conf_val = call_res.get('completion_confidence')
                else:
                    res_status = getattr(call_res, 'status', None)
                    call_id = str(getattr(call_res, 'id', ''))
                    task_completed = bool(getattr(call_res, 'task_completed', False))
                    structured_result_val = getattr(call_res, 'structured_result', None)
                    evidence_val = getattr(call_res, 'evidence', None)
                    summary_val = getattr(call_res, 'summary', "")
                    fail_code = getattr(call_res, 'failure_code', "")
                    fail_msg = getattr(call_res, 'failure_message', "")
                    conf_val = getattr(call_res, 'completion_confidence', None)

                if res_status in ('failed', 'error', 'canceled'):
                    status = 'failed'
                elif res_status == 'completed':
                    status = 'completed'
                else:
                    status = 'completed' if task_completed else 'failed'

                res_parts = []
                if summary_val:
                    res_parts.append(f"Summary:\n{summary_val}")
                if fail_msg or fail_code:
                    f_str = f"[{fail_code}] {fail_msg}".strip() if fail_code else fail_msg
                    res_parts.append(f"Failure Reason:\n{f_str}")
                if conf_val and isinstance(conf_val, dict):
                    score = conf_val.get('score')
                    label = conf_val.get('label')
                    if score is not None:
                        res_parts.append(f"Completion Confidence: {int(score * 100)}% ({label or ''})")

                result_text = "\n\n".join(res_parts) if res_parts else (summary_val or fail_msg or "Call completed without summary.")

            except ImportError:
                _logger.info("CALL-E SDK ('calle-ai') package not found.")
                status = 'failed'
                result_text = "CALL-E SDK ('calle-ai') package not found."
            except Exception as sdk_err:
                safe_err = _sanitize_provider_error(sdk_err)
                _logger.warning(
                    "CALL-E call creation request failed or ended with an ambiguous outcome (Log #%d): %s",
                    call_log_id, safe_err
                )
                status = 'failed'
                result_text = (
                    f"Ambiguous Creation Outcome: Call creation request failed or ended without a deterministic HTTP response ({safe_err}). "
                    "The call may have been initiated on the provider side. Auto-retry stopped to prevent duplicate phone calls. Manual review required."
                )

            write_vals = {
                'status': status,
                'call_id': call_id or False,
                'result_text': _sanitize_provider_error(result_text),
                'task_completed': task_completed,
            }
            if structured_result_val is not None:
                if isinstance(structured_result_val, dict):
                    raw_s = "\n".join(f"{k}: {v}" for k, v in structured_result_val.items())
                elif isinstance(structured_result_val, list):
                    raw_s = json.dumps(structured_result_val, indent=2)
                else:
                    raw_s = str(structured_result_val)
                write_vals['structured_result'] = _sanitize_provider_error(raw_s)

            if evidence_val is not None:
                if isinstance(evidence_val, list):
                    raw_e = "\n".join(f"• {item}" for item in evidence_val if item)
                elif isinstance(evidence_val, dict):
                    raw_e = json.dumps(evidence_val, indent=2)
                else:
                    raw_e = str(evidence_val)
                write_vals['evidence'] = _sanitize_provider_error(raw_e)

            call_log.write(write_vals)

            # Post sanitized summary note to chatter
            chatter_body = _sanitize_provider_error(
                f"CALL-E Phone Call {status.upper()}.\n{write_vals['result_text']}"
            )
            try:
                if call_log.exists():
                    call_log.message_post(body=chatter_body)
                if target_rec and hasattr(target_rec, 'message_post'):
                    target_rec.message_post(body=chatter_body)
                new_cr.commit()
            except Exception as post_err:
                _logger.warning("Failed to post completion message to chatter: %s", _sanitize_provider_error(post_err))

            # Execute any matching response Python code actions on thread (completed & task_completed & bound record only)
            if (
                status == 'completed'
                and task_completed
                and rule_rec
                and rule_rec.exists()
                and isinstance(structured_result_val, dict)
                and server_action
                and server_action.exists()
            ):
                sections = server_action.calle_section_ids.sorted(key=lambda s: s.id)
                for idx, sec in enumerate(sections, 1):
                    sec_key = f"s_{idx}"
                    if sec_key in structured_result_val:
                        ans_val = str(structured_result_val[sec_key]).strip()
                        for resp in sec.response_ids:
                            if resp.name.strip().lower() == ans_val.lower():
                                if resp.action_code and resp.action_code.strip():
                                    _logger.info("Executing Python code action for response '%s' in section '%s'", ans_val, sec_key)
                                    try:
                                        eval_context = {
                                            'env': new_env,
                                            'record': rule_rec,
                                            'logger': _logger,
                                        }
                                        safe_eval(resp.action_code, eval_context, mode="exec")
                                        new_cr.commit()
                                    except Exception as code_err:
                                        _logger.exception("Error executing response code action for answer '%s': %s", ans_val, code_err)
                                        new_cr.rollback()

