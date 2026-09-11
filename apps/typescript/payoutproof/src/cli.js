#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { compilePlan, normalizeResult } from "./core.js";
import { runCalle } from "./calle.js";

function arg(name){const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]:undefined;}
const mode=process.argv[2];
if (!new Set(["preview","plan","start","normalize"]).has(mode)) { console.error("usage: node src/cli.js preview|plan|start|normalize --input packet.json [--approval-id id] [--result result.json]"); process.exit(2); }
const file=arg("--input"); if(!file){console.error("--input is required");process.exit(2);}
try {
 const plan=compilePlan(JSON.parse(readFileSync(file,"utf8")));
 if(mode==="preview") console.log(JSON.stringify({...plan,calle_args:{...plan.calle_args,to_phone:plan.masked_phone}},null,2));
 else if(mode==="normalize") console.log(JSON.stringify(normalizeResult(plan,JSON.parse(readFileSync(arg("--result"),"utf8"))),null,2));
 else console.log(JSON.stringify(runCalle(mode,plan,{approvalId:arg("--approval-id")}),null,2));
} catch(e){console.error(e.message);process.exit(1);}
