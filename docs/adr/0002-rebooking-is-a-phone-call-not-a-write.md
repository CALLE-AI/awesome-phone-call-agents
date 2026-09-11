# Rebooking is a phone call, not a write

The Rebooking Call dials the practice's own booking line and waits in the ordinary
queue, rather than writing an appointment into the booking system.

This looks absurd written down — the practice calling itself — so it is worth being
explicit that it is deliberate. No practice grants an agent write access to
appointments in EMIS or SystmOne, and none should; the phone is the actual
integration surface of primary care, not a workaround for one. Reception is a human
gate that already exists and already works, and routing through it means the
workflow needs no privileged integration to be real at any practice.

The hold time is therefore not removed. It is served to an agent instead of to an
82-year-old — which is the point, and is why "Queue Absorption" is a term in
CONTEXT.md rather than an implementation note.
