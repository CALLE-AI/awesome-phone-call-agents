#!/usr/bin/env node
const args = parseArgs(process.argv.slice(2));
const need = (args.need || "housing").toLowerCase();
const country = (args.country || "US").toUpperCase();
const region = args.region || "";
const city = args.city || "";
const live = Boolean(args.live);
const NATIONAL = {
  US: {
    self_harm: { name: "988 Suicide & Crisis Lifeline", phone_e164: "+1988", hours: "24/7", url: "https://988lifeline.org", national: true },
    dv: { name: "National Domestic Violence Hotline", phone_e164: "+18007997233", hours: "24/7", url: "https://www.thehotline.org", national: true },
    housing: { name: "211 (United Way)", phone_e164: "+1211", hours: "24/7", url: "https://www.211.org", national: true },
    food: { name: "211 (United Way)", phone_e164: "+1211", hours: "24/7", url: "https://www.211.org", national: true },
    isolation: { name: "988 Suicide & Crisis Lifeline", phone_e164: "+1988", hours: "24/7", url: "https://988lifeline.org", national: true }
  }
};
const SAMPLES = {
  housing: [{ name: "Sample City Shelter Intake", phone_e164: "+15550101", hours: "Mon-Sun 8:00-20:00", url: "https://example.org/shelter", source: "sample-dataset" }],
  food: [{ name: "Sample Community Food Bank", phone_e164: "+15550102", hours: "Mon-Fri 9:00-17:00", url: "https://example.org/food", source: "sample-dataset" }],
  dv: [{ name: "Sample DV Advocacy & Safe Shelter", phone_e164: "+15550103", hours: "24/7", url: "https://example.org/dv", source: "sample-dataset" }],
  deportation: [{ name: "Sample Immigrant Legal Aid Clinic", phone_e164: "+15550104", hours: "Mon-Fri 9:00-16:00", url: "https://example.org/legal", source: "sample-dataset" }],
  medical: [{ name: "Sample Community Health Clinic", phone_e164: "+15550105", hours: "Mon-Sat 8:00-18:00", url: "https://example.org/clinic", source: "sample-dataset" }],
  fraud: [{ name: "Sample Consumer Protection / APS", phone_e164: "+15550106", hours: "Mon-Fri 8:30-17:00", url: "https://example.org/protect", source: "sample-dataset" }],
  self_harm: [{ name: "Sample Local Warmline", phone_e164: "+15550107", hours: "Daily 12:00-24:00", url: "https://example.org/warmline", source: "sample-dataset" }],
  isolation: [{ name: "Sample Peer Support Warmline", phone_e164: "+15550108", hours: "Daily 16:00-24:00", url: "https://example.org/peer", source: "sample-dataset" }]
};
const place = [city, region, country].filter(Boolean).join(", ");
const query = buildQuery(need, place);
async function main() {
  if (live && process.env.RESEARCH_URL) {
    try { const results = await liveResearch(query); const nat = (NATIONAL[country]&&NATIONAL[country][need])||null; out({ ok:true, mode:"live", query, candidates:results, national_fallback:nat }); return; }
    catch (e) { const nat=(NATIONAL[country]&&NATIONAL[country][need])||null; out({ ok:true, mode:"live_failed_fallback", query, error:String(e.message||e), candidates:(SAMPLES[need]||[]), national_fallback:nat }); return; }
  }
  const nat=(NATIONAL[country]&&NATIONAL[country][need])||null; out({ ok:true, mode:"dry-run", query, candidates:(SAMPLES[need]||[]), national_fallback:nat });
}
function buildQuery(need, place){const phrase={housing:"emergency homeless shelter intake",food:"food bank pantry help",dv:"domestic violence hotline safe shelter",deportation:"immigration legal aid know your rights",medical:"free community health clinic",fraud:"consumer fraud victim help legal aid",self_harm:"crisis line warmline mental health support",isolation:"peer support warmline loneliness"}[need]||"crisis help";return place?phrase+" "+place:phrase;}
async function liveResearch(q){const url=process.env.RESEARCH_URL;const headers={"Content-Type":"application/json","User-Agent":"crisis-lifeline-bridge/0.1"};if(process.env.RESEARCH_TOKEN)headers["Authorization"]="Bearer "+process.env.RESEARCH_TOKEN;const resp=await fetch(url,{method:"POST",headers,body:JSON.stringify({q,n:10})});if(!resp.ok)throw new Error("research endpoint "+resp.status);const j=await resp.json();const rows=(j.results||j.items||[]);return rows.slice(0,10).map(r=>({name:r.title||r.name||"(unnamed)",url:r.link||r.url||"",source:r.source||"",snippet:r.snippet||r.summary||"",phone_e164:null,needs_verification:true}));}
function parseArgs(argv){const o={};for(let i=0;i<argv.length;i++){const a=argv[i];if(a.startsWith("--")){const key=a.slice(2);const next=argv[i+1];if(next===undefined||next.startsWith("--")){o[key]=true;}else{o[key]=next;i++;}}}return o;}
function out(obj){process.stdout.write(JSON.stringify(obj,null,2)+"\n");}
main().catch(e=>{out({ok:false,error:String(e.message||e)});process.exit(1);});
