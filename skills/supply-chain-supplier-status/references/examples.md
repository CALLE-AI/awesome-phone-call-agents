# Examples

All company names, phone numbers, and representative contacts in these examples are synthetic and fictional.

## Example 1: On-Time Fulfillment Confirmation

### Call Transcript
> **Agent:** "Hello, this is CALL-E Procurement Assistant calling on behalf of Global Retail Operations on a recorded line. Am I speaking with the dispatch desk at Apex Components regarding Purchase Order PO-90124?"  
> **Supplier Contact:** "Yes, this is Apex dispatch. I have PO-90124 on my screen."  
> **Agent:** "Thank you. Our records show 500 units of Industrial Sensor Modules scheduled for fulfillment on September 15. Can you confirm this shipment is on track to arrive by the deadline?"  
> **Supplier Contact:** "Yes, production wrapped up yesterday. Packaging is complete and the freight carrier is scheduled for pickup tomorrow. You will have full delivery by September 15th."  
> **Agent:** "Excellent. Thank you for confirming. Our system has logged your delivery as on track. Have a great day!"

### Structured Output Record
```json
{
  "call_id": "call_mock_SUP-101_001",
  "supplier_id": "SUP-101",
  "purchase_order_id": "PO-90124",
  "fulfillment_status": "ON_TIME",
  "revised_delivery_date": "2026-09-15",
  "delay_days": 0,
  "delay_reason_category": "NONE",
  "delay_reason_details": "Production wrapped up; freight carrier pickup scheduled.",
  "estimated_financial_exposure_usd": 0.0,
  "escalation_contact_name": "N/A",
  "escalation_contact_phone": "N/A",
  "requires_escalation": false
}
```

---

## Example 2: Delayed Fulfillment with Escalation & Root Cause Analysis

### Call Transcript
> **Agent:** "Hello, this is CALL-E Procurement Assistant calling on behalf of Global Retail Operations on a recorded line. May I speak with the fulfillment coordinator for Pacific Packaging regarding Purchase Order PO-88120?"  
> **Supplier Contact:** "Speaking, this is David in fulfillment."  
> **Agent:** "Hello David. We are checking on 12,000 units of corrugated carton assemblies due on September 15. Can you confirm fulfillment status?"  
> **Supplier Contact:** "Unfortunately, we are experiencing delays. Our primary polymer resin adhesive shipment was held up at the regional port due to customs inspections."  
> **Agent:** "Understood, that falls under raw material shortages. When do you estimate the full shipment can be delivered?"  
> **Supplier Contact:** "We expect the resin tomorrow. We can deliver by September 20th."  
> **Agent:** "That represents a 5-day delay against the committed deadline. Could you provide the contact information for your plant manager in case our logistics lead needs to arrange expedited transit?"  
> **Supplier Contact:** "Sure, plant manager is Maria Gomez at +1-555-014-9923."  
> **Agent:** "Thank you David. I have logged the revised September 20 date, raw material shortage cause, and Maria Gomez as escalation lead. Our procurement team will follow up."

### Structured Output Record
```json
{
  "call_id": "call_mock_SUP-102_002",
  "supplier_id": "SUP-102",
  "purchase_order_id": "PO-88120",
  "fulfillment_status": "DELAYED",
  "revised_delivery_date": "2026-09-20",
  "delay_days": 5,
  "delay_reason_category": "RAW_MATERIAL_SHORTAGE",
  "delay_reason_details": "Polymer resin adhesive shipment delayed at regional port customs.",
  "estimated_financial_exposure_usd": 8350.0,
  "escalation_contact_name": "Maria Gomez",
  "escalation_contact_phone": "+15550149923",
  "requires_escalation": true
}
```

---

## Example 3: Aggregated CSV Export

```csv
call_id,supplier_id,supplier_name,po_id,original_date,revised_date,delay_days,status,category,financial_exposure_usd,escalation_lead,phone
call_mock_SUP-101_001,SUP-101,Apex Components,PO-90124,2026-09-15,2026-09-15,0,ON_TIME,NONE,0.00,N/A,+1-555-***-1100
call_mock_SUP-102_002,SUP-102,Pacific Packaging,PO-88120,2026-09-15,2026-09-20,5,DELAYED,RAW_MATERIAL_SHORTAGE,8350.00,Maria Gomez,+1-555-***-9923
```
