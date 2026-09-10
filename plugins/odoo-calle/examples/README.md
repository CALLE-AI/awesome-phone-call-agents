# CALL-E Odoo Plugin Examples & Data Templates

This directory contains reference Odoo XML data records demonstrating how to configure CALL-E Server Actions (`ir.actions.server`) and Automation Rules (`base.automation`) in Odoo 19.

## Included Examples & Module Data

1. [`partner_call_example.xml`](./partner_call_example.xml):
   - **Model**: `res.partner` (Contacts - `base` module)
   - **Data Integration**: Included in `'demo'` in `__manifest__.py` (inactive by default for safety).
   - **Phone Field**: `phone`
   - **Dialogue Prompts**: Verifies customer contact details and phone number on file.

2. [`crm_lead_qualification.xml`](./crm_lead_qualification.xml):
   - **Model**: `crm.lead` (CRM Leads & Opportunities - `crm` module)
   - **Data Integration**: Reference template in `examples/` directory.
   - **Phone Field**: `phone`
   - **Dialogue Prompts**: Conducts automated initial screening calls with leads to verify interest and schedule demos.

3. [`sales_order_confirmation.xml`](./sales_order_confirmation.xml):
   - **Model**: `sale.order` (Sales Orders - `sale` module)
   - **Data Integration**: Reference template in `examples/` directory.
   - **Phone Field**: `partner_id.phone`
   - **Dialogue Prompts**: Confirms delivery address and order details before shipping.

## Data Loading & Safety

Example XML templates are imported under `'demo'` inside `call_e/__manifest__.py` (or available as reference XML files) and have their automation rules set to `active="False"` by default:
```python
    'demo': [
        'data/partner_call_example.xml',
    ],
```
This ensures example automation rules are inactive upon installation and will not trigger automated calls until explicitly activated by an administrator in Odoo.

