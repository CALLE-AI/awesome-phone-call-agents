# Examples

## Restaurant booking (structured)

```bash
# Preview the booking plan (no call placed)
python3 calle_booking.py plan \
  --kind restaurant \
  --phone "+12125551234" \
  --name "Alex Doe" \
  --party-size 2 \
  --date 2026-09-15 \
  --time 19:00

# Place the booking (dials the restaurant)
python3 calle_booking.py book --confirm \
  --kind restaurant \
  --phone "+12125551234" \
  --name "Alex Doe" \
  --party-size 2 \
  --date 2026-09-15 \
  --time 19:00
```

## Medical appointment

```bash
python3 calle_booking.py book --confirm \
  --kind medical \
  --phone "+12125551234" \
  --name "Thethela Faltein" \
  --date 2026-09-16 \
  --reason "GP visit for annual checkup"
```

## Generic booking (any business type)

```bash
python3 calle_booking.py book --confirm \
  --kind vet \
  --phone "+12125551234" \
  --name "Alex Doe" \
  --date 2026-09-17 \
  --notes "Dog checkup, 3-year-old Labrador"
```

## Free-form task (just a goal + phone number)

```bash
python3 calle_booking.py book --confirm \
  --task "Call the mechanic at this number and ask if they can replace brake pads on a 2020 Toyota Corolla. Book it if they can, under the name Thethela Faltein. Get availability and pricing." \
  --phone "+12125551234"
```

## With calendar free slots

```bash
# Read free windows from calendar
FREE=$(python3 calendar_slots.py --source google --days 3)

# Inject them so CALL-E negotiates within your availability
python3 calle_booking.py book --confirm \
  --kind restaurant \
  --phone "+12125551234" \
  --name "Alex Doe" \
  --party-size 2 \
  --free-slots "$FREE"
```

## Fire-and-forget (don't block)

```bash
python3 calle_booking.py book --confirm --no-wait \
  --kind restaurant \
  --phone "+12125551234" \
  --name "Alex Doe" \
  --party-size 2

# Check on it later
python3 calle_booking.py status --call-id cal_abc123
```

## Custom result schema

```bash
cat > /tmp/garage_schema.json << 'JSON'
{
  "type": "object",
  "required": ["booked", "date", "time", "service", "price_estimate"],
  "properties": {
    "booked": {"type": "boolean"},
    "date": {"type": "string"},
    "time": {"type": "string"},
    "service": {"type": "string"},
    "price_estimate": {"type": "integer"},
    "confirmation_number": {"type": "string"}
  }
}
JSON

python3 calle_booking.py book --confirm \
  --kind generic \
  --schema-file /tmp/garage_schema.json \
  --task "Book a brake pad replacement at the garage" \
  --phone "+12125551234"
```