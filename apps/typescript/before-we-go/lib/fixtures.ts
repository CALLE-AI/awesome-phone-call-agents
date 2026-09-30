import {assess,type Extraction,type Turn} from './domain.ts';
export const fixtureTurns:Turn[]=[
{id:'t1',speaker:'agent',text:'Hi, I am the AI enquiry assistant for The Courtyard, a fictional restaurant in this transcribed demo. You asked about Sunday lunch. Are you happy to continue?'},
{id:'t2',speaker:'recipient',text:'Yes. I need a ground-floor table with no steps for our family lunch.'},
{id:'t3',speaker:'agent',text:'Our entrance and ground-floor dining area are step-free. A staff member still needs to confirm a ground-floor table for your visit; I cannot promise availability.'},
{id:'t4',speaker:'recipient',text:'Can my father get from that table to an accessible toilet without steps?'},
{id:'t5',speaker:'agent',text:'There is a ground-floor toilet, but its doorway width, turning space and complete step-free route are not verified in the information I have. That needs a staff check.'},
{id:'t6',speaker:'recipient',text:'We cannot lift or carry his wheelchair. Please check those details before we decide.'},
{id:'t7',speaker:'agent',text:'Understood. I will capture your need for a step-free table, a suitable toilet route and no lifting. Staff need to confirm the table and toilet details. No booking or callback time is confirmed.'}];
export const fixtureExtraction:Extraction={permission:'allowed',open_questions:['Confirm ground-floor table availability and toilet access details.'],requirements:{
entrance_table:{answer:'requested',detail:'Customer wants a ground-floor, step-free table for family lunch.',quote:fixtureTurns[1].text,agent_quote:fixtureTurns[2].text,follow_up:'Confirm ground-floor table availability for the requested visit.'},
table_toilet:{answer:'requested',detail:'Customer asks whether the route from the table to a suitable toilet is step-free.',quote:fixtureTurns[3].text,agent_quote:fixtureTurns[4].text,follow_up:'Check the complete toilet route, doorway width and turning space with staff.'},
no_lifting:{answer:'requested',detail:'Customer cannot lift or carry the wheelchair.',quote:fixtureTurns[5].text,agent_quote:fixtureTurns[6].text,follow_up:'Ensure the proposed route requires no lifting or carrying.'}}};
export type Scenario='barrier'|'no_answer'|'refusal'|'missing_transcript';
export const scenarios={barrier:'Customer asks about a family visit',no_answer:'Customer does not answer',refusal:'Customer declines',missing_transcript:'Transcript unavailable'} as const;
export function sample(s:Scenario){return assess('synthetic example','The Courtyard — fictional restaurant',s==='no_answer'?'failed':'completed',s==='no_answer'?null:s==='refusal'?{...fixtureExtraction,permission:'refused'}:fixtureExtraction,s==='missing_transcript'||s==='no_answer'?[]:s==='refusal'?[{id:'r1',speaker:'recipient',text:'No thank you. Please do not call again.'}]:fixtureTurns);}
