# Lead Quote Callback Template

Edit this file when the Google Form fields or CALL-E goal should change. The
scripts read the JSON configuration and the goal template from this file.

```json
{
  "name": "lead-quote-callback",
  "title": "Commercial Ice Machine Quote Request",
  "description": "Submit this form to request a quote. We may call you about this quote request.",
  "submissionAuthorizesCallback": true,
  "phoneField": "phone",
  "recipientNameField": "lead_name",
  "language": "English",
  "resultField": "call_result",
  "summaryField": "call_summary",
  "requiredFields": ["lead_name", "phone", "product_interest"],
  "fields": [
    {
      "slug": "lead_name",
      "title": "Lead name",
      "type": "short_text",
      "required": true
    },
    {
      "slug": "phone",
      "title": "Phone",
      "type": "short_text",
      "required": true,
      "validation": "^\\+[1-9]\\d{6,14}$",
      "helpText": "Use E.164 format, for example +14045550176."
    },
    {
      "slug": "product_interest",
      "title": "Product interest",
      "type": "short_text",
      "required": true
    },
    {
      "slug": "known_need",
      "title": "Known need",
      "type": "paragraph",
      "required": false
    }
  ],
  "outputFields": [
    {
      "slug": "call_result",
      "title": "Call result",
      "type": "status_column"
    },
    {
      "slug": "call_summary",
      "title": "Call summary",
      "type": "summary_column"
    }
  ]
}
```

## Goal Template

```text
Follow up with a lead who submitted an ad form, confirm their interest, collect the missing quote details.

Call {{phone}} and ask to speak with {{lead_name}}.

Explain that {{lead_name}} recently submitted a form asking about {{product_interest}}.

{{#known_need}}
Mention the known requirement: {{known_need}}.
{{/known_need}}

Collect the missing quote details:
- daily_ice_need
- ice_type_preference
- storage_bin_needed
- water_and_drain_access
- budget_range
- preferred_contact_method

If the lead asks for pricing, explain that the quote depends on the missing details and that a human sales representative can follow up with the final quote.
```
