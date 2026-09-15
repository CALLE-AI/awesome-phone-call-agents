import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("CALL-E transports run in Workers and never forward credentials through redirects",async(t)=>{
  const root=fileURLToPath(new URL("..",import.meta.url));
  const bundle=await build({stdin:{contents:`
    import { verifyCallEKey } from './lib/connection';
    import { providerRequest } from './lib/calle';
    export default { async fetch(request){
      try{
        if(new URL(request.url).pathname==='/connection')await verifyCallEKey('runtime-fixture-key');
        else await providerRequest('test-owner','/call_fixture');
        return Response.json({ok:true});
      }catch(e){return Response.json({error:e.message},{status:502});}
    }};
  `,resolveDir:root,loader:"ts"},bundle:true,write:false,format:"esm",platform:"browser",external:["cloudflare:workers"]});
  let redirect=false;const requests=[];
  const mf=new Miniflare({modules:true,compatibilityDate:"2026-05-15",script:bundle.outputFiles[0].text,
    bindings:{CALLE_API_KEY:"runtime-fixture-key",CALLE_API_KEY_OWNER_ID:"test-owner"},d1Databases:["DB"],
    outboundService(request){
      requests.push({url:request.url,method:request.method,authorization:request.headers.get("authorization")});
      if(redirect)return new Response(null,{status:302,headers:{Location:"https://unexpected.example/"}});
      return Response.json(new URL(request.url).pathname.includes("goals")?{data:[]}:{id:"call_fixture"});
    },
  });
  t.after(()=>mf.dispose());
  await (await mf.getD1Database("DB")).exec("CREATE TABLE calle_connections (owner TEXT PRIMARY KEY, ciphertext TEXT, iv TEXT, verified_at TEXT)");
  for(const path of ["/connection","/call"]){
    const response=await mf.dispatchFetch(`http://localhost${path}`);
    const result=await response.json();
    assert.equal(response.status,200,`${path}: ${result.error??""}`);
    assert.equal(result.ok,true);
  }
  assert.equal(requests.length,2);
  assert.equal(requests.every(r=>r.method==="GET"&&r.authorization==="Bearer runtime-fixture-key"),true);
  redirect=true;
  for(const path of ["/connection","/call"]){
    const before=requests.length;
    const response=await mf.dispatchFetch(`http://localhost${path}`);
    assert.equal(response.status,502);
    assert.equal(requests.length,before+1,"Redirect must never trigger a second outbound request");
  }
  assert.equal(requests.every(r=>new URL(r.url).origin==="https://api.heycall-e.com"),true);
});
