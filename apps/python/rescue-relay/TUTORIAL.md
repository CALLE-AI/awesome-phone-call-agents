> Conditional goals now remain one plan. Review branch rules before approving; record the assigned responder’s assessment to activate only the applicable tasks. Recording makes no call. For CALL-E readiness errors, see UPGRADE_5_6.md.

> Updated for 5.6.0: select a proposed goal, then choose **Confirm goal** to save it. **Find help** is a separate action. Bundled recordings show the earlier 5.4.0 flow.

# Rescue Relay — complete user tutorial

This guide follows the app from a fresh launch to a completed report. The bundled example uses fictional contacts and replies. The same workspace and approval flow are used in Live mode; only consent, transport status and demo-specific controls differ.

## 1. Open your workspace

Install and start the app using README.md, then open http://127.0.0.1:8000. The top toolbar shows **Demo**. Sound is off by default. **Walkthrough** opens the chaptered video player in another tab, so it does not replace your report.

The left navigation contains **Report an incident**, **Rescue** and **Trusted contacts**. A new demo database already includes a receiving clinic, a transport/rescue team and an observer. Opening the app creates no incident and begins no inquiry.

## 2. Prepare trusted contacts

Open **Trusted contacts**. Use **Add contact** to save a name, a description of their services and the specific capabilities they offer. Confirm that the person or organisation has approved receiving rescue calls. In a live installation, provide a valid international-format number belonging to the consenting contact.

For the tutorial, add `Willow Road Volunteer`, describe a nearby volunteer who can observe from a safe distance, select the observation capability and tick the contact-permission box. Save the contact. This optional step demonstrates the directory; it is not needed to complete the loaded rescue example.

Use a contact’s edit action to update its saved details. In Demo mode, **Demo replies** opens optional fictional behaviour and reply controls. These are test data, not live preferences or actual helper statements.

## 3. Load and review the report

Return to **Report an incident**. Choose **Try the demo**, read the small confirmation and continue. The example adds Greenway Rescue and Kindred Rescue, then fills an editable dog report, location and USD 200 budget. Loading it replaces the current draft but does not delete saved reports or submit an inquiry.

The dog cannot put weight on its rear leg. The location is **Beside the blue shop on Willow Road**. Check the observations, animal type, location and budget. For your own report, describe what you can actually see rather than assuming a diagnosis. Give a recognisable location. A budget is a limit for reviewing offers, not permission to spend.

The draft feedback tells you whether it is saved for the current browser tab. When browser storage is unavailable, the app says the draft is kept only while the page remains open.

## 4. Clarify what success means

Choose **Send**. When asked what a successful rescue means, enter:

> I want trained responders to safely rescue the dog and transport it to a veterinarian who will accept it for assessment.

Send the answer. Read the goal recap and location. You can edit the information or answer further clarification questions. A conversation with the intake form is still a draft; selecting the proposed goal and using **Confirm goal** saves it without starting inquiries.

The required tasks in this example are safe containment, a ride to care and a place ready to receive the animal. A different confirmed goal may need a different combination of services.

## 5. Find available help

Select and confirm the reviewed goal. The app opens the saved **Rescue** report. Choose **Find help** to begin the availability inquiry. The first complete plan pauses the search. In this example, **Greenway Rescue** offers all three required tasks for **USD 300**, which is above the **USD 200** budget. The quoted timing is also shown.

An offer is not the same as asking a helper to begin. You can review it before deciding. **Stop** during an active inquiry prevents subsequent work; it is not a guaranteed hang-up for an already submitted live call.

## 6. Compare the alternative

Choose **Find another option**. The original offer and selection remain intact. Once **Kindred Rescue** replies, open the complete-plan comparison. Its **USD 150** quote is within the example budget; the saved timing is 25 minutes, compared with Greenway’s 12 minutes.

Compare the entire set of tasks, price scope, terms and timing rather than only the headline number. Choose Kindred’s complete plan. Selecting it updates the plan; it does not call the helper back or approve work.

For a closer look, open **Details & history**, then the conversation section. Open an individual helper’s reply to read the saved transcript. The technical log is separately collapsed. Close Details to return to your next action.

## 7. Review and approve the selected helper

Choose **Review & approve**. The dialog lists only the selected plan’s helper, included tasks and quote/price limits. Read it, tick the approval checkbox and choose **Approve & confirm helpers**.

Leaving the checkbox unticked cannot start the callback. **Cancel** or Escape closes the dialog without approval. Once approved, only Kindred Rescue receives the separate confirmation callback in this example. The unselected offer is not engaged.

A successful callback moves the helper to ready. It does not assume that the helper has departed, arrived or completed the work. Approval does not authorise extra charges, medical treatment or payment.

## 8. Record confirmed progress

When you or the helper confirm departure, choose **On the way** and confirm the update. Record **Arrived** only after arrival is confirmed. For a receiving-only helper, the corresponding step concerns the animal being received. Mark **Finished** after the helper’s assigned work is done.

Each update is an explicit action with a confirmation dialog. Refreshing, polling or waiting does not advance these stages automatically. The demo uses these same controls; it does not skip progress steps to create a successful ending.

## 9. Confirm a safe outcome

After the helper finishes, use the completion action. Enter the closing note:

> The dog has been safely received at the clinic. The intake team confirmed arrival and the rescue team has finished.

Confirm that the animal is safe, then submit. The rescue becomes completed and your closing note appears on the main result. Typing the note without confirming does not close the rescue.

## 10. Share and revisit

Choose **Copy a shareable update**. If browser clipboard access is unavailable, the app downloads the update as a text file instead. Demo exports retain their practice label, so a fictional example is not confused with a real rescue. Review the content before forwarding it.

**Switch report** lets you return to saved cases. Opening an existing report preserves its history and does not place new calls. Use **New report** for a different incident rather than rewriting what happened in a completed case.

## When a reply needs attention

**A condition is unresolved.** The next action may offer a condition check. Read the prerequisite, then explicitly request the follow-up. In Demo mode, choose the reply you are testing. A pending answer remains pending. Resolving a condition is still not plan approval.

**A callback has an incomplete price or commitment.** Open the saved reply. When **Confirm with helper** is available, use it to reconfirm the approved tasks and original price limit with that helper. A retry requires your action. Earlier attempts remain in the report.

**The price increases or a helper declines.** Do not treat the helper as ready. Review the flagged terms and the available next action. The app retains the original approval limits; it does not silently accept a new price or replace the chosen helper.

**Provider status is uncertain.** Review the saved provider information before any intentional retry. The app blocks unsafe repeat calls rather than guessing that the last call failed. Stop and local timeouts cannot prove that an external call has ended.

**No complete offer is available.** Review remaining approved contacts, explicitly ask another suitable contact, or add one who can cover the missing need. Do not approve an incomplete plan as though it covers the full goal.

## Optional settings

The toolbar’s connection-details button shows the active calling and model configuration. Settings are read from the server’s `.env` file and require a restart after changes. The sound control is optional, defaults off, and never replaces the visible status text.

For deterministic rehearsal, leave model and provider keys blank. The fallback parser and fictional responses make the bundled example reproducible. Live verification is a separate local, consented exercise described in submission/LIVE_VERIFICATION.md, not a prerequisite for watching the videos.
