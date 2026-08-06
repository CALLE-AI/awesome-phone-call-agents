#!/usr/bin/env node
import { spawn } from "node:child_process";
const args = parseArgs(process.argv.slice(2));
const live = Boolean(args.live);
const need = (args.need || "housing").toLowerCase();
const agency = args.agency || "the service line";
const toPhone = args["to-phone"] || "";
const region = args.region || "US";
const language = args.language || "en";
const timezone = args.timezone || "America/New_York";
const calleBin = args["calle-bin"] || "calle";
const pollTimeout = args["poll-timeout"] || "120";
const SAMPLE = /^\+1555010\d$/;
const goal = buildGoal(need, agency);
async function main() {
  if (!live) {
    out({ ok:true, mode:"dry-run", would_call:mask(toPhone), plan_goal:goal,
      note:"No call placed. Re-run with --live and a real, consented E.164 number to verify for real.",
      simulated_result:{ verified:true, agency_name:agency, phone_masked:mask(toPhone), line_status:"in_service (simulated)", intake_hours:"simulated 8:00-20:00 local", capacity_tonight:"simulated: space available", recommend_refer:true } });
    return;
  }
  if (!toPhone) fail("live mode requires --to-phone in E.164 format");
  if (!/^\+[1-9]\d{6,14}$/.test(toPhone)) fail("--to-phone must be E.164, e.g. +14155550142");
  if (SAMPLE.test(toPhone)) fail("refusing to place a live call to a fictional sample number (+1 555 01xx)");
  const env = { ...process.env, CALLE_SOURCE:process.env.CALLE_SOURCE||"skills_sh", CALLE_INTEGRATION:process.env.CALLE_INTEGRATION||"skills_sh_skill", CALLE_INTEGRATION_VERSION:process.env.CALLE_INTEGRATION_VERSION||"0.1.0" };
  const planned = await calle(env, ["mcp","call","--args-json",JSON.stringify({user_input:goal+" The number to call is "+toPhone+"."}),"plan_call","--poll-timeout-seconds",pollTimeout,"--json"]);
  const plan = extractStructured(planned);
  const planId = plan && plan.plan_id;
  if (!planId) fail("plan_call did not return a plan_id: "+JSON.stringify(planned).slice(0,400));
  await calle(env, ["call","plan","--plan-id",planId,"--to-phone",toPhone,"--region",region,"--language",language,"--timezone",timezone,"--poll-timeout-seconds",pollTimeout,"--json"]);
  await calle(env, ["call","run","--plan-id",planId,"--poll-timeout-seconds",pollTimeout,"--json"]);
  const statusRaw = await calle(env, ["call","status","--plan-id",planId,"--json"]);
  const status = extractStructured(statusRaw) || statusRaw;
  out({ ok:true, mode:"live", plan_id:planId, phone_masked:mask(toPhone), agency_name:agency, plan_goal:goal, call_status:status, note:"Only refer the person if the line was confirmed real, in service, and able to help." });
}
function buildGoal(need, agency){const needPhrase={housing:"emergency shelter / housing intake",food:"food assistance",dv:"domestic-violence support and safe shelter",deportation:"immigration legal aid",medical:"non-emergency community health services",fraud:"fraud-victim assistance",self_harm:"crisis / mental-health support",isolation:"peer support"}[need]||"support services";return "Verify that "+agency+" is a real, currently in-service "+needPhrase+" line. Confirm it is legitimate and reachable, ask their current intake hours, and ask whether they have capacity to help someone today. You are confirming public service details only and represent no specific person; do not share anyone's identity or situation. If nobody answers, note that and end politely. Report back: is the line real and in service, intake hours, and whether they can help today.";}
function calle(env, argv){return new Promise((resolve,reject)=>{const p=spawn(calleBin,argv,{env});let so="",se="";p.stdout.on("data",d=>so+=d.toString());p.stderr.on("data",d=>se+=d.toString());p.on("error",reject);p.on("close",code=>{if(code!==0&&!so.trim())return reject(new Error("calle "+argv[0]+" exit "+code+": "+se.slice(0,300)));try{resolve(JSON.parse(so));}catch{resolve({_raw:so});}});});}
function extractStructured(resp){if(!resp)return null;const r=resp.result||resp;if(r&&r.structuredContent)return r.structuredContent;const content=r&&r.content;if(Array.isArray(content)&&content[0]&&content[0].text){try{return JSON.parse(content[0].text);}catch{return null;}}if(resp.structuredContent)return resp.structuredContent;return null;}
function mask(phone){if(!phone)return "(none)";const s=String(phone);if(s.length<=5)return s;return s.slice(0,3)+"\u2022".repeat(Math.max(0,s.length-5))+s.slice(-2);}
function parseArgs(argv){const o={};for(let i=0;i<argv.length;i++){const a=argv[i];if(a.startsWith("--")){const key=a.slice(2);const next=argv[i+1];if(next===undefined||next.startsWith("--")){o[key]=true;}else{o[key]=next;i++;}}}return o;}
function out(obj){process.stdout.write(JSON.stringify(obj,null,2)+"\n");}
function fail(msg){out({ok:false,error:msg});process.exit(1);}
main().catch(e=>{out({ok:false,error:String(e.message||e)});process.exit(1);});
