import logging
from odoo import fields, models

_logger = logging.getLogger(__name__)

AVAILABLE_LOCALES = [
    ('en-US', 'English (US)'),
    ('en-GB', 'English (UK)'),
    ('en-CA', 'English (Canada)'),
    ('en-AU', 'English (Australia)'),
    ('en-IN', 'English (India)'),
    ('en-SG', 'English (Singapore)'),
    ('en-MY', 'English (Malaysia)'),
    ('en-PH', 'English (Philippines)'),
    ('en-KE', 'English (Kenya)'),
    ('en-NG', 'English (Nigeria)'),
    ('en-BW', 'English (Botswana)'),
    ('en-NA', 'English (Namibia)'),
    ('es-ES', 'Spanish (Spain)'),
    ('es-MX', 'Spanish (Mexico)'),
    ('es-HN', 'Spanish (Honduras)'),
    ('fr-FR', 'French (France)'),
    ('fr-CM', 'French (Cameroon)'),
    ('de-DE', 'German (Germany)'),
    ('it-IT', 'Italian (Italy)'),
    ('pt-BR', 'Portuguese (Brazil)'),
    ('pt-PT', 'Portuguese (Portugal)'),
    ('pt-MZ', 'Portuguese (Mozambique)'),
    ('ja-JP', 'Japanese'),
    ('zh-CN', 'Chinese (Simplified)'),
    ('ko-KR', 'Korean'),
    ('nl-NL', 'Dutch'),
    ('ru-RU', 'Russian'),
    ('uk-UA', 'Ukrainian'),
    ('ar-SA', 'Arabic (Saudi Arabia)'),
    ('ar-AE', 'Arabic (UAE)'),
    ('ar-OM', 'Arabic (Oman)'),
    ('tr-TR', 'Turkish'),
    ('sv-SE', 'Swedish'),
    ('no-NO', 'Norwegian'),
    ('da-DK', 'Danish'),
    ('fi-FI', 'Finnish'),
    ('pl-PL', 'Polish'),
    ('vi-VN', 'Vietnamese'),
    ('id-ID', 'Indonesian'),
    ('bn-BD', 'Bengali (Bangladesh)'),
    ('th-TH', 'Thai'),
    ('si-LK', 'Sinhala (Sri Lanka)'),
    ('ur-PK', 'Urdu (Pakistan)'),
]


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    calle_api_key = fields.Char(
        string="CALL-E API Key",
        config_parameter='call_e.api_key',
        help="API Key obtained from CALL-E developer dashboard"
    )
    calle_pending_timeout_minutes = fields.Integer(
        string="Pending Call Timeout (Minutes)",
        config_parameter='call_e.pending_timeout_minutes',
        default=30,
        help="Minutes after which a pending call log is considered timed out and auto-expired"
    )
    calle_default_locale = fields.Selection(
        selection=AVAILABLE_LOCALES,
        string="Default Call Locale",
        config_parameter='call_e.default_locale',
        default='en-US',
        help="Supported locale for CALL-E AI phone calls"
    )
