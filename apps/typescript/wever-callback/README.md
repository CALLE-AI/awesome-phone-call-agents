# Wever Callback

Wever Callback helps consignment boutiques follow up with people who have asked to hear from them. A customer requests a callback, the business reviews the inquiry, and an approved CALL-E interview collects item details and a preferred consultation time. The conversation, result and staff follow-up stay together in an inquiry inbox.

The intended customer is a small consignment team that needs to qualify incoming consignor inquiries while serving people in the shop. The next useful outcome is a prepared consultation request for staff to confirm. The assistant does not promise item acceptance, resale prices, commissions or payouts.

This contribution contains a runnable local application with the business setup, customer inquiry form, inbox, sample rehearsals and opt-in CALL-E workflow. It is an experimental community application, not a CALL-E SDK or a production hosting package.

## Hosted product and local contribution

[Open the hosted product walkthrough](https://wever-callback.codewever.chatgpt.site/demo).

The hosted guide and sample customer form are public. Its persistent sample workspace uses ChatGPT sign-in and keeps each account's records separate. The hosted sample form and rehearsals are simulated and use no call credits. They do not replay a real customer call.

An owner-reported test of the hosted application completed a real CALL-E phone interview on September 10, 2026 and saved its transcript and structured consultation request. That private call, its recipient details and its recording are not included in this contribution. The local port's fake tests do not independently establish live-call behavior. A later clarification change instructs the assistant to confirm exact dates instead of inventing dates from relative phrases; that change needs its own live verification before claiming a verified voice result.

The local contribution uses one workspace on your own computer. Its Vite development adapter supplies a local workspace identity and accepts only a loopback connection with a loopback Host. It does not require a ChatGPT account, use a hosted workspace database, or depend on unpublished private packages. This adapter is not production authentication. Do not expose the development server through a tunnel, proxy, LAN address or public hosting service. The production build does not include this development identity adapter.

## Requirements

- Node.js 24 and npm.
- A desktop browser on the same computer as the development server.
- Internet access to install the public npm dependencies.
- A CALL-E account, a valid API key and available calling credits only if you choose to enable live calling.

The local runtime uses React, TypeScript and Vinext with Cloudflare's local D1 emulator. Local setup applies the included SQLite migrations; a deployed Cloudflare database is not required.

## Install and start

From this application directory:

```bash
npm ci
npm run setup
npm run dev
```

Open [the local sample workspace](http://127.0.0.1:4175/?demo=1).

`npm run setup` creates an ignored `.dev.vars` file containing a random local encryption secret and `CALLBACK_ALLOW_LIVE_CALLS=false`, then applies local database migrations. Running setup again preserves the existing file. Keep that encryption secret unchanged so previously saved CALL-E credentials remain readable.

The development server binds to `127.0.0.1:4175`. Stop it with Ctrl+C. This stops the local server, not a call that CALL-E has already accepted.

## Try the complete sample workflow

No key or calling credits are needed for these steps.

1. In **Sample workspace**, choose **Load sample inquiries**.
2. Open **Maya Chen**. Choose **Interested, requests a consultation**, then run the sample rehearsal.
3. Open **Conversation** to review the fictional dialogue and structured result.
4. Open **Next steps**, add a follow-up note and save it. To rehearse recording a confirmed booking, choose **Booked by you**, enter a complete date, time and time zone, and save.
5. Close and reopen the inquiry to check that the saved result and note persist.
6. Try the other sample scenarios for a pricing question that needs a person and a request to stop calling.

Sample records use fictional people and reserved phone numbers. The rehearsal action never sends a CALL-E call request, even when live calling is enabled. Sample records and live inquiries use separate inbox tabs. Only manually confirmed bookings count as booked; a preferred time from a conversation remains a request.

The [local walkthrough](http://127.0.0.1:4175/demo) also links to a fictional customer form. That particular sample form stays in the page and sends nothing.

## Customer inquiry intake

In **Business setup**, save the business name, approved facts, interview purpose, questions, boundaries and intended next step. The included Second Story Consignment scenario is fictional and can be used for an owner test.

Under **Customer inquiry form**, review the customer introduction and prepare the form. Open the generated link on the same computer to submit a request. The form records the name, phone number, time zone, inquiry and the explicit callback-consent statement. It creates a **Customer callback form** inquiry in the workspace; submitting the form does not dial anyone.

This local form is a loopback test surface. Its link is not a public customer intake service. The hosted product has its own separately managed form links and account access.

## Opt in to one real CALL-E interview

Real calls can use credits. The default configuration blocks live call creation on the server. Sample rehearsals remain available without enabling live mode.

1. Stop the local server.
2. Edit the existing `.dev.vars` file. Change only the live-call setting below and preserve `CALLE_KEY_ENCRYPTION_SECRET`:

   ```dotenv
   CALLBACK_ALLOW_LIVE_CALLS=true
   ```

3. Restart with `npm run dev`.
4. In **CALL-E connection**, enter your own API key and save/check it. This makes a read-only account check against `https://api.heycall-e.com/v1/goals?limit=1`; it does not place a call. The key is encrypted before local database storage.
5. Save complete **Business setup** instructions. Use only facts the assistant is authorized to state.
6. Add a **Live inquiry** for your own phone or another recipient who explicitly requested this AI-assisted callback. Use a valid US `+1` E.164 number, the recipient's actual time zone, and a note explaining when and how they agreed. Do not use the fictional sample numbers as real destinations.
7. Open the inquiry and review the destination, business instructions and intended outcome. Approve the individual callback only when the recipient is ready.
8. Answer the phone, then use **Check call status** to retrieve the result. Review **Conversation** and save the human follow-up under **Next steps**.

The live transport uses CALL-E's HTTPS Calls API at `https://api.heycall-e.com/v1/calls`, an idempotency key and a requested structured result schema. Credentials are not sent to arbitrary provider URLs, and authenticated requests do not follow redirects. A returned schema or summary is still something the business must review.

To disable further live call creation, stop the server, set `CALLBACK_ALLOW_LIVE_CALLS=false` in `.dev.vars`, then restart. Disabling live mode does not cancel a previously accepted call.

## Calling boundaries and recovery

- A person must request the callback, and the local operator must separately approve the call. There is no automatic dialing on form submission, page load, sample rehearsal or local setup.
- Normal customer calling hours are 9 AM to 6 PM in the recipient's selected time zone. Use the recipient's actual time zone.
- One call attempt is associated with each live inquiry. A phone number also has a 24-hour call-attempt cooldown. Creating another inquiry does not remove that cooldown.
- Do-not-call outcomes stay excluded from the calling queue, including other inquiries for the same number.
- An ambiguous delivery result stops automatic redial. Check the provider dashboard and link the original call reference when available. Do not create a replacement inquiry to replay an uncertain call.
- A submission explicitly rejected before acceptance may be recovered only through a fresh approval of that same stored request and idempotency key. A timeout, unavailable response or unreadable response is not proof that no call was placed.
- Failed or unanswered calls do not become successful interviews. Unclear outcomes require review.
- No recurring jobs are created. There is no background campaign scheduler to cancel.
- Once CALL-E accepts a call, this app cannot cancel it. Closing the browser, stopping the server or disabling future calls does not reliably stop an accepted call. Review the provider's account controls if intervention is needed; do not assume cancellation succeeded.
- Real-number displays and logs should be masked. Do not publish exports, screenshots, private transcripts or recordings from actual recipients.
- This workflow does not provide medical, legal, financial or emergency advice, take payments, request sensitive identifiers, or make consequential decisions in those domains. Keep the business instructions within the consignment intake use case and refer exceptions to a person.

## Appointments and saved outcomes

CALL-E collects a requested consultation time. The assistant is instructed to clarify an exact month, day, year, time and time zone and to preserve uncertainty when clarification fails. It does not check a calendar or create a booking.

Staff must confirm availability with the customer outside the application. **Booked by you** records that human confirmation in the inquiry. There is no calendar integration, scheduling guarantee, item valuation, purchase, payment or automatic sales conversion claim.

## Local data and credentials

Business settings, inquiries, consent, call records, transcripts and notes are persisted in the local D1/SQLite state under `.wrangler/`. A saved CALL-E key is encrypted using AES-GCM with the random secret in `.dev.vars`; it is not shown again in the UI.

Treat both `.wrangler/` and `.dev.vars` as private local state. Anyone with both and access to your computer can access the stored data. This is not protection from other users or software on the same machine. Keep the encryption file if you need to continue using an existing saved connection. If it is lost or replaced, reconnect your CALL-E account with a new key entry.

The app's ignore rules exclude `.dev.vars`, environment files, local database state, dependencies, build output and logs. Do not force-add those files, upload a working directory containing them, or commit real call exports. The distributed source contains only fictional examples. Use your own credentials locally; no shared account key is provided.

## Validation

Run the focused application checks from this directory:

```bash
npm test
npm run typecheck
npm run build
```

Tests use local fixtures and mocked provider requests. They must not require real credentials or place calls. A successful build validates compilation; it is not a remote deployment or a live telephony test.

From the community repository root, also run:

```bash
python3 scripts/validate_repository.py
```

For manual verification, use the sample workflow above, check that records survive a restart, and confirm live creation stays disabled with the default setting. Any optional live verification requires the separate opt-in, credits, authorized recipient and individual approval described above.

## License and attribution

MIT. See [LICENSE](LICENSE). The community repository's upstream copyright and permission notice are preserved; Wever Labs retains authorship of its contribution. Third-party packages remain under their respective licenses. The bundled stylesheet's notice is retained in [vendor/shadcn-tailwind-4.13.0.LICENSE.md](vendor/shadcn-tailwind-4.13.0.LICENSE.md).

CALL-E provides the calling service. This community application is not an official CALL-E SDK and does not imply CALL-E endorsement.
