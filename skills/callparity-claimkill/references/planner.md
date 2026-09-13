# Planner

Input: a claim graph, candidate `RefutationQuestion` values, and a spoken-time budget (default 90 seconds at 2.5 words per second).

1. Map `CONFIRMED` to `SUPPORTED`.
2. Set any node with confidence below 0.45 to `ABSTAIN`. Do not plan a question against it.
3. Score each question with `leak_score`.
   - `1.0` if the text contains `warehouse said dock 3` or another Party A attribution marker.
   - `0.9` if the text repeats Party A's evidence quote of three or more words.
   - `0.0` if the question only asks an observable Party B could have seen.
4. Discard when `leak_score` is 0.5 or higher. That is leak-drop.
5. Among kept questions that target an `UNTESTED` or `SUPPORTED` node and fit the spoken-time budget, pick the cheapest. Cheapest means shortest spoken time, then question id.
6. Return that question as call N+1, the remaining spoken-time budget, the kept list, and the dropped list. Place zero calls.

On FR-1842, `warehouse said dock 3?` is shorter than `Was dock 3 empty when you pulled in?` and must still drop. If leak-drop is broken, preview selects the leak.

The merger, not the spoken script, records the contradiction.
