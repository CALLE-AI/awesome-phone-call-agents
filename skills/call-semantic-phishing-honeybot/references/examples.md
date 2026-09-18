# Examples

## Example 1: Extracting Crypto Wallet

**Input:**
```python
caller_number = "555-0199"
text = "To fix your PC, you need to send 500 dollars to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa immediately."
```

**Output Report:**
```json
{
  "caller_number": "555-0199",
  "extracted_iocs": {
    "urls": [],
    "crypto_wallets": ["1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"],
    "phone_numbers": []
  },
  "action": "continue_baiting",
  "bait_prompt": "Pretend you don't know how to use Bitcoin and ask for alternative payment methods to stall them."
}
```

## Example 2: Extracting Phishing URL

**Input:**
```python
caller_number = "555-0122"
text = "Your account is locked. Go to www.secure-bank-update.com right now."
```

**Output Report:**
```json
{
  "caller_number": "555-0122",
  "extracted_iocs": {
    "urls": ["www.secure-bank-update.com"],
    "crypto_wallets": [],
    "phone_numbers": []
  },
  "action": "continue_baiting",
  "bait_prompt": "Tell them the website is blocked by your antivirus and ask what to do next."
}
```
