# MoboFarmer — Let the farm make its own phone calls

Mobo = mobile-first + Sesotho mohoma (farm). Farmers live 2-3h/day calling co-ops, transporters, buyers.

**Don't ask farmer to look at data. Let farm make its own calls.**

3 Agents:

1. Input Sourcing Agent: Calls Afgri, OVK, NTK for 50 bags L33 under R900 near Bothaville
   Extraction: item_available boolean, price_per_bag number, stock_quantity number, next_delivery_date date, alternative_product string

2. Market Linker Agent: Calls Joburg Fresh Produce Market, Tshwane Market
   Extraction: buyer_name, produce_grade_accepted, price_per_kg, pickup_needed, payment_terms_days
   Model: Charge BUYER for lead, not farmer.

3. Water & Service Coordinator: Calls Water User Association, vet, transporter
   Extraction: confirmed boolean, time datetime, cost number

Setup: CALL-E SDK calle.calls.createAndWait({goal, phone_numbers, extraction_schema})
Side effects: Places real outbound calls. Dry-run: npm run demo = local fake, no call
Cancellation: One-shot calls, reconciled in CALL-E dashboard
Credentials: CALL-E_API_KEY env only, masked numbers +27XXXXXXXXX in docs
