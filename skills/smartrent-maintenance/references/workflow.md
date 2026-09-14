# Workflow Reference

## State Machine

```
CREATED
  ↓ (tenant intake call)
TENANT_CALLING → TENANT_CALLED
  ↓ (vendor dispatch call)
VENDOR_SEARCHING → VENDOR_FOUND
  ↓ (tenant confirmation call)
TENANT_CONFIRMING → TENANT_CONFIRMED → COMPLETED
```

Any step can transition to `FAILED` on error or unsuccessful outcome.

## Call Task Templates

### Tenant Intake
```
Call {tenant_name} at {phone} about a maintenance request for
Unit {unit_number} at {property_name}. They initially reported:
'{initial_description}'. Politely gather: (1) What type of issue
it is, (2) How urgent it is, (3) Where exactly in the unit the
issue is, (4) How a maintenance person can access the unit,
(5) Any additional details.
```

### Vendor Dispatch
```
Call {vendor_name} at {phone}. You are calling on behalf of
{property_name} property management. There is a {urgency}
{issue_type} issue in Unit {unit_number}. Ask: (1) Are you
available today? (2) What is your ETA? (3) What is the
approximate cost?
```

### Tenant Confirmation
```
Call {tenant_name} at {phone}. You've found a vendor:
{vendor_name}. They can arrive {eta}, estimated cost
{cost_estimate}. Ask if this works for them.
```
