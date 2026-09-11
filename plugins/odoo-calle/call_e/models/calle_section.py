# -*- coding: utf-8 -*-
from odoo import models, fields

class CalleSection(models.Model):
    _name = 'calle.section'
    _description = 'CALL-E Section'
    _rec_name = 'section_text'
    _order = 'id'

    server_action_id = fields.Many2one('ir.actions.server', string="Server Action", required=False, ondelete='cascade')
    parent_response_id = fields.Many2one('calle.section.response', string="Parent Answer", required=False, ondelete='cascade')
    section_text = fields.Text(string="Script / Question Text", required=True, help="Text to speak or question to ask. Jinja2 expressions like {{ record.name }} are supported.")
    
    response_ids = fields.One2many('calle.section.response', 'section_id', string="Expected Responses", help="Leave empty for general/open-ended questions.")
