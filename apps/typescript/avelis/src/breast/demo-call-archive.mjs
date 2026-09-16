// Authored fictional conversations; never provider calls or clinical records.
export const EMMA_CALL_ARCHIVE=[
 {id:'demo-emma-2026-07-15',patient_id:'bc-emma',created_at:'2026-07-15T14:00:00.000Z',summary:'Emma reports mild hot flashes since starting tamoxifen and occasional left arm tightness. No missed doses or current emergency symptoms were reported. These concerns were recorded for care-team review.',outcome:'Dr Sarah Chen reviewed the report on July 16 and documented follow-up without a medication change.',transcript:`Agent: Hello, this is Avelis, the automated follow-up assistant for your breast care team. Am I speaking with Emma Wilson?
Patient: Yes, Emma speaking.
Agent: Is it a convenient time? Your answers will be recorded for the care team. Is that okay?
Patient: Sure, that's fine.
Agent: Before we start, are you having severe chest pain, trouble breathing, or difficulty staying awake right now?
Patient: No, none of those.
Agent: You started tamoxifen earlier this month. How have things been going?
Patient: Mostly okay. I get these warm spells, though. Sorry, what did you call them?
Agent: Some people describe them as hot flashes. Can you tell me what yours feel like?
Patient: I suddenly feel really warm, then it passes. A few minutes, maybe. Not every day.
Agent: When did you first notice that, and is it getting worse or affecting sleep?
Patient: After I started the tablets. It's pretty mild. I'm sleeping okay, and it hasn't got worse.
Agent: Anything else new or uncomfortable?
Patient: My left arm sometimes feels tight. The surgery side. No swelling that I can see.
Agent: Any redness, warmth, pain or difficulty moving that arm?
Patient: No. Just a bit tight now and then. I can do my usual things.
Agent: Have you missed any tablets or changed how you take them?
Patient: No, I've taken them the way the team told me.
Agent: Have you had unusual vaginal bleeding, a new lump, or another persistent change?
Patient: No, I haven't noticed anything like that.
Agent: Is the November appointment still in your calendar?
Patient: Yes, November first.
Agent: I'll record the mild hot flashes and occasional left arm tightness for the care team. I can't change medication instructions or promise a callback time. Does that describe what you told me?
Patient: Yes, that's right. Thanks.
Agent: Thank you for speaking with me. Goodbye.`},
 {id:'demo-emma-2026-08-01',patient_id:'bc-emma',created_at:'2026-08-01T14:00:00.000Z',summary:'Compared with July, Emma describes hot flashes and occasional left arm tightness as stable and mild. She reports no visible arm swelling, sleep disruption or missed medication. This became the baseline for the September comparison.',outcome:'On August 2, Dr Sarah Chen recorded a plan to compare sleep, hot flashes and arm symptoms at the next contact. The current September concern remains a separate, open review.',transcript:`Agent: Hello, may I confirm this is Emma Wilson? This is Avelis, the automated follow-up assistant for your breast care team.
Patient: Yes, it's me.
Agent: Is now convenient, and do you agree to your answers being recorded for the care team?
Patient: Yes. Sorry, can you speak a little more slowly?
Agent: Of course. Are you having severe chest pain, trouble breathing, or difficulty staying awake right now?
Patient: No.
Agent: Last time you described mild hot flashes and occasional tightness in your left arm. Have those changed?
Patient: Not much. The warm spells still happen, but they're manageable.
Agent: How often, and do they wake you or affect your day?
Patient: A few times a week. They don't wake me up. I can still do everything normally.
Agent: And the arm tightness: any swelling, redness, warmth or increasing pain?
Patient: No swelling. It feels tight sometimes, about the same as before. No redness or pain.
Agent: Are you still following the prescribed treatment? Any missed doses or changes?
Patient: I missed—sorry, I mean I nearly forgot one evening. I did take it. I haven't missed a dose.
Agent: To confirm, you have not missed any doses?
Patient: That's right.
Agent: Have you noticed unusual vaginal bleeding, a new lump, or any other new or worsening symptom?
Patient: No, nothing new.
Agent: How are your sleep, appetite, usual activities and mood?
Patient: All okay. I worry a little sometimes, but I'm getting on with things.
Agent: Is the follow-up appointment on November first still arranged?
Patient: Yes, it's in my calendar.
Agent: I'll record that the hot flashes and arm tightness are similar to last time, with no reported swelling or missed doses. The care team can use this for the next comparison. Have I understood correctly?
Patient: Yes, you've got it.
Agent: Thank you. I cannot change your treatment instructions. Goodbye.`}
].map(c=>({...c,provider:'mock',historical_demo:true,state:'FINISHED',status:'COMPLETED',recording_url:null}));
