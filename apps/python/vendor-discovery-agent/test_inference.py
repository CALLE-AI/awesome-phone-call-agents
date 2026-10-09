import sys, json, os
sys.path.insert(0, '.')

key = os.environ.get("GROQ_API_KEY")
if not key:
    print("GROQ_API_KEY not set yet — paste your key and rerun")
    sys.exit(0)

from caller import infer_from_transcript

# Simulate a positive R1 transcript
r1_lines = [
    {"time": "00:00:00", "speaker": "BOT",  "text": "Hi, I'm calling about sourcing shoes in bulk. Do you supply wholesale?"},
    {"time": "00:00:04", "speaker": "USER", "text": "Yes we do, we supply to several retailers already."},
    {"time": "00:00:08", "speaker": "BOT",  "text": "Great — would you be open to a follow-up call about quantities and pricing?"},
    {"time": "00:00:11", "speaker": "USER", "text": "Sure, send someone over or call back, we're happy to discuss."},
]

print("=== R1 Inference (positive) ===")
r1 = infer_from_transcript(r1_lines, "bulk shoe supply", round_num=1)
print(json.dumps(r1, indent=2))

# Simulate a positive R2 transcript
r2_lines = [
    {"time": "00:00:00", "speaker": "BOT",  "text": "Hi, following up — can I get the contact name for procurement?"},
    {"time": "00:00:04", "speaker": "USER", "text": "Sure, speak to James at james@clarks.co.uk"},
    {"time": "00:00:08", "speaker": "BOT",  "text": "And roughly what quantities can you supply per month?"},
    {"time": "00:00:11", "speaker": "USER", "text": "We can do 500 to 2000 pairs monthly depending on the style."},
    {"time": "00:00:15", "speaker": "BOT",  "text": "Price range per pair?"},
    {"time": "00:00:17", "speaker": "USER", "text": "Wholesale is between 20 and 45 pounds depending on style."},
    {"time": "00:00:21", "speaker": "BOT",  "text": "Earliest timeline to start?"},
    {"time": "00:00:23", "speaker": "USER", "text": "We could start within 2 weeks if the order is confirmed."},
]

print("\n=== R2 Inference ===")
r2 = infer_from_transcript(r2_lines, "bulk shoe supply", round_num=2)
print(json.dumps(r2, indent=2))
print("\nAll inference tests done.")
