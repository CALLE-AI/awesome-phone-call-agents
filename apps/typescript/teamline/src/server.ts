import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { LiveProvider, SandboxProvider, type CallProvider } from "./provider.js";
import { TeamLineWorkflow, normalizePhone } from "./workflow.js";

const provider = createProvider(process.env);
const sessions = new Map<string, TeamLineWorkflow>();
const port = Number(process.env.PORT ?? 3000);

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const session = sessionFor(request, response);
    if (request.method === "GET" && url.pathname === "/") return html(response, page());
    if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, session.state());
    if (request.method !== "POST") return json(response, 404, { error: "Not found." });
    const body = await readBody(request);
    if (url.pathname === "/api/phone") return json(response, 200, { masked: `••• ••• ${normalizePhone(String(body.phone ?? "")).slice(-4)}` });
    if (url.pathname === "/api/facility/start") return json(response, 200, await session.launchFacility(launchInput(body)));
    if (url.pathname === "/api/facility/reconcile") return json(response, 200, await session.reconcileFacility(launchInput(body)));
    if (url.pathname === "/api/facility/retry") return json(response, 200, await session.retryFacility(launchInput(body)));
    if (url.pathname === "/api/facility/check") return json(response, 200, await session.check("facility"));
    if (url.pathname === "/api/approve") return json(response, 200, session.approveFacilityDecision());
    if (url.pathname === "/api/parent/start") return json(response, 200, await session.launchParent(launchInput(body)));
    if (url.pathname === "/api/parent/reconcile") return json(response, 200, await session.reconcileParent(launchInput(body)));
    if (url.pathname === "/api/parent/retry") return json(response, 200, await session.retryParent(launchInput(body)));
    if (url.pathname === "/api/parent/check") return json(response, 200, await session.check("parent"));
    return json(response, 404, { error: "Not found." });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : "Request failed." });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`TeamLine ${provider.mode} mode: http://127.0.0.1:${port}`);
  if (provider.mode === "live") console.log("LIVE MODE: a telephone call occurs only after an explicit call button is selected.");
});

export function createProvider(environment: NodeJS.ProcessEnv): CallProvider {
  const mode = environment.CALLE_MODE?.trim().toLowerCase() || "sandbox";
  if (mode === "sandbox") return new SandboxProvider();
  if (mode !== "live") throw new Error("CALLE_MODE must be sandbox or live.");
  if (!environment.CALLE_API_KEY) throw new Error("CALLE_API_KEY is required in live mode.");
  return new LiveProvider(environment.CALLE_API_KEY);
}

function sessionFor(request: IncomingMessage, response: ServerResponse): TeamLineWorkflow {
  const existing = request.headers.cookie?.match(/(?:^|;\s*)teamline_session=([0-9a-f-]{36})/)?.[1];
  const id = existing ?? randomUUID();
  if (!existing) response.setHeader("set-cookie", `teamline_session=${id}; HttpOnly; SameSite=Strict; Path=/`);
  let workflow = sessions.get(id);
  if (!workflow) {
    workflow = new TeamLineWorkflow(provider);
    sessions.set(id, workflow);
  }
  return workflow;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
    if (chunks.reduce((sum, value) => sum + value.length, 0) > 16_384) throw new Error("Request is too large.");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function launchInput(body: Record<string, unknown>) {
  return { phone: String(body.phone ?? ""), consent: body.consent === true };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function html(response: ServerResponse, value: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(value);
}

function page(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TeamLine</title><style>
body{font:16px/1.5 system-ui;margin:0;background:#f4f7f5;color:#17221c}main{max-width:860px;margin:auto;padding:32px 18px}section{background:white;border:1px solid #cad8cf;border-radius:14px;padding:20px;margin:16px 0}button,input{font:inherit;padding:10px 14px}button{cursor:pointer;background:#145b3a;color:white;border:0;border-radius:8px}button:disabled{opacity:.45;cursor:not-allowed}.secondary{background:#46564d}.banner{background:#fff4d6;border-color:#d8a52d}.muted{color:#526158}.result{white-space:pre-wrap;background:#edf4ef;padding:12px;border-radius:8px}label{display:block;margin:8px 0}.actions{display:flex;gap:8px;flex-wrap:wrap}code{background:#edf0ee;padding:2px 4px}
</style></head><body><main><p>TEAMLINE</p><h1>When a conversation works better than a text.</h1><p>TeamLine is an AI Voice Communication Assistant for Coaches.</p><section class="banner"><strong id="mode"></strong><p>Every live call requires an explicit button click. Checking a result never places a call. TeamLine never redials automatically.</p></section><section><h2>Demo recipient</h2><form id="phone-form"><label>US phone number <input id="phone" type="tel" autocomplete="tel" placeholder="(202) 555-0142" required></label><label><input id="consent" type="checkbox"> I consent to each TeamLine demo call I explicitly request.</label><button>Use this number</button></form><p id="phone-state"></p></section><section><h2>1. Find something out</h2><p>Ask a fictional Athletic Director about Friday facility availability. TeamLine may gather facts and return requests; it may not reschedule, spend, or commit the team.</p><div class="actions"><button id="facility-start" disabled></button><button id="facility-reconcile" hidden>Reconcile existing call intent</button><button id="facility-check" class="secondary" hidden>Check existing call result</button><button id="facility-retry" hidden>Try the call again</button><button id="approve" hidden>Coach: approve practice change</button></div><div id="facility-result"></div></section><section><h2>2. Pass something along</h2><p>After coach approval, communicate only the approved change and collect attendance and transportation responses.</p><div class="actions"><button id="parent-start" disabled></button><button id="parent-reconcile" hidden>Reconcile existing call intent</button><button id="parent-check" class="secondary" hidden>Check existing call result</button><button id="parent-retry" hidden>Try the call again</button></div><div id="parent-result"></div></section><p><a href="https://youtu.be/2btXyqeA3Wg">Watch the TeamLine demo video</a> · <a href="https://teamline-judge-console.netlify.app/teamline/demo">Functional competition demo</a></p></main><script>
let state,phone='',ready=false,busy=false;const $=id=>document.getElementById(id);const post=async(path,body={})=>{const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error);return value};const callInput=()=>({phone,consent:true});
async function load(){state=await(await fetch('/api/state')).json();render()}
function attemptText(value){if(!value)return'';if(value.status==='dispatching')return '<p class="result">Submitting this call intent once…</p>';if(value.status==='create_uncertain')return '<p class="result">CALL-E may have accepted this call, but TeamLine did not receive a definitive response. No new call may be started. Reconcile this same intent; a timeout is not permission to redial.</p>';if(value.status==='in_progress')return '<p class="result">Call accepted / in progress. Check result retrieves this same call and never starts another.</p>';if(value.status==='no_answer')return '<p class="result">The call was not answered. No conversation occurred.</p>';if(value.status==='failed')return '<p class="result">CALL-E reported a failed call. No automatic retry occurred.</p>';return '<pre class="result">'+escapeHtml(JSON.stringify(value.result,null,2))+'</pre>'}
function escapeHtml(value){return value.replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]))}
function render(){const live=state.mode==='live';$('mode').textContent=live?'LIVE CALL-E MODE — call buttons place real outbound calls.':'SANDBOX MODE — local fixtures only; no telephone call is placed.';$('facility-start').textContent=live?'Place one Athletic Director call':'Start Athletic Director no-call fixture';$('parent-start').textContent=live?'Place one Parent call':'Start Parent no-call fixture';$('facility-start').disabled=busy||!ready||!!state.facility;$('parent-start').disabled=busy||!ready||state.decision!=='approved'||!!state.parent;$('facility-reconcile').hidden=state.facility?.status!=='create_uncertain';$('facility-reconcile').disabled=busy||!ready;$('parent-reconcile').hidden=state.parent?.status!=='create_uncertain';$('parent-reconcile').disabled=busy||!ready;$('facility-check').hidden=state.facility?.status!=='in_progress';$('facility-check').disabled=busy;$('parent-check').hidden=state.parent?.status!=='in_progress';$('parent-check').disabled=busy;$('facility-retry').hidden=state.facility?.status!=='no_answer';$('facility-retry').disabled=busy||!ready;$('parent-retry').hidden=state.parent?.status!=='no_answer';$('parent-retry').disabled=busy||!ready;$('approve').hidden=state.decision!=='awaiting_coach';$('approve').disabled=busy;$('facility-result').innerHTML=attemptText(state.facility);$('parent-result').innerHTML=attemptText(state.parent)}
$('phone-form').addEventListener('submit',async event=>{event.preventDefault();try{if(!$('consent').checked)throw new Error('Consent is required.');const value=await post('/api/phone',{phone:$('phone').value});phone=$('phone').value;ready=true;$('phone-state').textContent='Ready: '+value.masked;$('phone').value='';render()}catch(error){$('phone-state').textContent=error.message}});
async function action(path,kind){if(busy)return;if(kind==='call'&&state.mode==='live'&&!confirm('This places one real outbound CALL-E call. Continue?'))return;if(kind==='reconcile'&&state.mode==='live'&&!confirm('This resubmits the same unresolved CALL-E intent with its existing idempotency key. It does not authorize a second logical call. Continue?'))return;busy=true;render();try{state=await post(path,kind==='call'||kind==='reconcile'?callInput():{});render()}catch(error){alert(error.message);await load()}finally{busy=false;render()}}
$('facility-start').onclick=()=>action('/api/facility/start','call');$('facility-reconcile').onclick=()=>action('/api/facility/reconcile','reconcile');$('facility-check').onclick=()=>action('/api/facility/check','none');$('facility-retry').onclick=()=>action('/api/facility/retry','call');$('approve').onclick=()=>action('/api/approve','none');$('parent-start').onclick=()=>action('/api/parent/start','call');$('parent-reconcile').onclick=()=>action('/api/parent/reconcile','reconcile');$('parent-check').onclick=()=>action('/api/parent/check','none');$('parent-retry').onclick=()=>action('/api/parent/retry','call');load();
</script></body></html>`;
}
