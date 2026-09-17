# Examples

## Example 1: Tech Support Scam
**Scammer**: "Hello, this is Microsoft Support. Your computer has a virus. Go to www.windows-fix-now.com."
**Agent (Honeybot)**: "Oh dear, a virus? My grandson just bought me this computer. Let me find my reading glasses... what was the website again? windows-fix...?"
**Result**: The agent extracts `www.windows-fix-now.com` as a malicious IoC (Indicator of Compromise) and successfully wastes 15 minutes of the scammer's time by pretending the computer is booting up.

## Example 2: IRS/Tax Scam
**Scammer**: "You owe back taxes. You must pay immediately via Bitcoin. Send it to this wallet address: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa."
**Agent (Honeybot)**: "Bitcoin? I don't know what that is. Can I buy it at Walmart? Please read that long code again so I can write it down."
**Result**: The agent logs the Bitcoin wallet address `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` and tags the call as `T1566` (Phishing).
