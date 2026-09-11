# Learning Recall Call Examples

## Example 1: Strong Recall

### Topic

Hashing vs Encryption

### Study Context

Hashing is generally a one-way transformation used to produce a fixed-length digest. Encryption is designed to allow data to be recovered using the appropriate key.

### Learner Response

"Hashing converts the input into a fixed-length value, and it is generally one-way. Encryption is different because encrypted data can be recovered using the appropriate key."

### Expected Assessment

- Recall: Strong
- No misconception detected
- Increase the next review interval
- Follow-up question: Ask the learner to explain when hashing would be preferred over encryption.

---

## Example 2: Misconception Detection

### Topic

Hashing vs Encryption

### Study Context

Hashing is generally a one-way transformation used to produce a fixed-length digest. Encryption is designed to allow data to be recovered using the appropriate key.

### Learner Response

"Hashing encrypts the password so that we can decrypt it later."

### Expected Assessment

A misconception should be detected.

The learner is confusing hashing with reversible encryption.

The assessment should identify:

- Concept: Hashing vs encryption
- Student belief: Hashing is reversible encryption
- Correct understanding: Hashing is generally one-way, while encryption is designed to allow recovery using the appropriate key.
- Evidence: The learner explicitly described hashing as something that can be decrypted later.

The learner should then receive a concise explanation and another question to verify whether the misconception has been corrected.

---

## Example 3: Partial Recall

### Topic

Binary Search

### Study Context

Binary search operates on sorted data. It repeatedly compares the target with the middle element and eliminates half of the remaining search space.

### Learner Response

"Binary search looks through the middle of the list to find the value. If it doesn't find it, it keeps searching."

### Expected Assessment

The learner demonstrates partial recall.

The learner remembers that binary search uses the middle element but does not explain that the data must be sorted or that half of the search space is eliminated after each comparison.

Weak areas may include:

- sorted input requirement
- elimination of half the search space

A suitable follow-up question is:

"Why does binary search need the data to be sorted?"

---

## Example 4: Previous Weak Area

### Topic

TCP vs UDP

### Previous Weak Area

- Reliability differences between TCP and UDP

### Learner Response

"TCP makes sure packets arrive and UDP is faster because it doesn't have all those checks."

### Expected Assessment

The learner demonstrates a reasonable understanding of the main distinction.

The next question should probe deeper:

"What does TCP do when a packet is lost?"

If the learner answers correctly, the previous weak area can be considered improved.

---

## Example 5: Learner Cannot Remember

### Topic

Public Key Cryptography

### Learner Response

"I remember studying this, but I can't remember how the two keys work."

### Expected Behavior

Do not shame the learner.

Do not immediately give a long explanation.

Ask a simpler question or provide a small hint.

Example:

"That's okay. Let's start with one part. Do you remember whether the public key is intended to be kept secret or shared?"

The response should be evaluated as uncertainty or a knowledge gap, not automatically as a misconception.

---

## Example 6: Request for the Answer

### Learner Response

"I don't know. Can you just tell me?"

### Expected Behavior

Provide a concise explanation.

Then continue with another recall question.

Example:

"Sure. The public key can be shared, while the private key is kept secret. Now, can you tell me which key would normally be used to decrypt something encrypted with a public key?"

---

## Example 7: Adaptive Difficulty

### Initial Topic

Recursion

### Strong Learner Response

"Recursion is when a function calls itself, usually with a base case that stops the recursion."

### Expected Follow-Up

Increase difficulty.

Example:

"Why is the base case necessary, and what would happen if a recursive function had no reachable base case?"

### Weak Learner Response

"I think recursion means repeating something until it finishes."

### Expected Follow-Up

Reduce difficulty.

Example:

"Let's make it simpler. What does it mean when a function calls itself?"

---

## Example 8: Review Recommendation

### Strong Recall

If the learner demonstrates accurate understanding and successfully applies the concept:

Recommended next review:

`7 days`

### Good Recall

If the learner understands the main concept but has minor gaps:

Recommended next review:

`3 days`

### Partial Recall

If the learner remembers some important concepts but has significant gaps:

Recommended next review:

`1 day`

### Weak Recall or Persistent Misconception

If the learner demonstrates weak understanding or continues to express a misconception:

Recommended next review:

`1 day`