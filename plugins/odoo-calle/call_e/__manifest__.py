{
    'name': 'CALL-E Integration',
    'version': '19.0.1.0.0',
    'category': 'Extra Tools',
    'summary': 'Trigger AI phone calls via CALL-E SDK in Server Actions & Automation Rules',
    'icon': '/call_e/static/description/icon.png',
    'description': """
CALL-E Integration for Odoo
=================================
Automate outbound AI phone calls using CALL-E SDK as an action in Odoo Server Actions and Automation Rules.

Features:
---------
* Add 'Trigger CALL-E Phone Call' action type to Server Actions.
* Support dynamic Jinja2 task templates (e.g. Call {{ record.phone }} to confirm {{ record.name }}).
* Strict E.164 phone format validation with automatic skipping & logging for non-compliant numbers.
* Call execution history log model (`calle.call`).
* Configurable API Key in Odoo Settings.
* Example Server Actions and Automation Rules included for Contacts (`res.partner`).
    """,
    'author': 'CALL-E',
    'website': 'https://heycall-e.com',
    'depends': ['base', 'base_automation', 'mail'],
    'data': [
        'security/ir.model.access.csv',
        'views/res_config_settings_views.xml',
        'views/ir_actions_server_views.xml',
        'views/calle_call_views.xml',
        'views/menu_views.xml',
    ],
    'demo': [
        'data/partner_call_example.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'call_e/static/src/scss/calle_sections_editor.scss',
            'call_e/static/src/js/calle_sections_editor.js',
            'call_e/static/src/xml/calle_sections_editor.xml',
        ],
    },
    'installable': True,
    'application': True,
    'pre_init_hook': 'pre_init_hook',
    'license': 'LGPL-3',
}
