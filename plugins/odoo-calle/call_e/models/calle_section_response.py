# -*- coding: utf-8 -*-
from odoo import models, fields

class CalleSectionResponse(models.Model):
    _name = 'calle.section.response'
    _description = 'CALL-E Section Response Choice'
    _order = 'id'

    section_id = fields.Many2one('calle.section', string="Section", required=True, ondelete='cascade')
    name = fields.Char(string="Expected Answer", required=True, help="e.g. Yes, No, Reschedule, etc.")
    action_code = fields.Text(string="Python Code", help="Python code to execute on record when this answer is returned. Variables available: env, record, logger")

    child_section_ids = fields.One2many(
        'calle.section',
        'parent_response_id',
        string="Follow-up Sections",
        help="Sections to execute only if this answer is confirmed by the caller."
    )
