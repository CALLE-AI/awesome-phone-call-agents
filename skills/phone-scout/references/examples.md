# Examples

## Restaurant research (Cape Town)

```bash
python3 phone_scout.py search \
  --objective "Find restaurants in Cape Town for 2 people this weekend, budget R1000 per person" \
  --constraints '{"party_size":2,"max_price_per_person":1000}' \
  --max-calls 3
```

## Dentist research (Manhattan, budget in USD)

```bash
PHONE_SCOUT_CURRENCY='$' python3 phone_scout.py search \
  --objective "Find a dentist in Manhattan New York for teeth cleaning next week, budget $500" \
  --constraints '{"max_price_per_person":500}' \
  --max-calls 3
```

## Plan only (discovery, no calls)

```bash
python3 phone_scout.py search \
  --objective "Find barber shops in Sandton for a haircut this Friday, budget R400" \
  --constraints '{"max_price_per_person":400}' \
  --max-calls 3 \
  --plan-only
```

## Verify results from sub-agents

```bash
python3 phone_scout.py verify \
  --results-file /tmp/results.json \
  --constraints '{"party_size":2,"max_price_per_person":1000}'
```

## Rank results from sub-agents

```bash
python3 phone_scout.py rank \
  --results-file /tmp/results.json \
  --constraints '{"party_size":2,"max_price_per_person":1000}'
```

## Single business research (for delegation)

```bash
python3 phone_scout.py call-one \
  --candidate-id "rest-001" \
  --name "Kloof Street House" \
  --phone "+27214234413" \
  --research-questions availability available_time estimated_price_per_person booking_requirements \
  --context "Customer wants dinner for 2 in Cape Town this weekend, budget R1000/person"
```

## Config for a new user in NYC

```bash
export PHONE_SCOUT_CURRENCY="$"
export PHONE_SCOUT_TZ="America/New_York"
export PHONE_SCOUT_DEFAULT_LOCATION="New York City"
export CALLE_API_KEY="gsk_jT..."
export GOOGLE_PLACES_API_KEY="AIzaSy..."
```