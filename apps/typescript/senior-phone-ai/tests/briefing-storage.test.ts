import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("encrypted snapshots, daily deduplication and the CALL-E payload work together without live calls", () => {
  const output = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { mkdtemp, readFile, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const storeUrl = pathToFileURL(join(process.cwd(),'lib/briefings/store.ts')).href;
    const clientUrl = pathToFileURL(join(process.cwd(),'lib/calle/client.ts')).href;
    process.env.CALLE_API_KEY = 'offline-fixture-key-not-a-real-credential';
    const root = await mkdtemp(join(tmpdir(), 'senior-briefing-test-'));
    process.chdir(root);
    const { saveProfile, prepareProfile, readBriefingState, resolveBriefingTask, prepareDueBriefings, deleteProfile } = await import(storeUrl);
    const { CalleRequestError, createCalleCall } = await import(clientUrl);
    let searches = 0;
    globalThis.fetch = async (input) => {
      assert.equal(String(input), 'https://api.openai.com/v1/responses');
      searches++;
      return Response.json({ id:'fixture-response', status:'completed', output:[{ type:'message', role:'assistant', content:[{ type:'output_text', text:'Synthetic local news from a verified fixture.', annotations:[{type:'url_citation', url:'https://example.com/news',title:'Fixture source'}] }] }] });
    };
    const profile = { id:'fixture', name:'Private fixture name', country:'Australia', countryCode:'AU', region:'NSW', locality:'Sydney', timezone:'Australia/Sydney', interests:['gardening'], topics:['news'], prepareAt:'00:00', autoPrepare:true, consentToPersonalization:true, officialDomains:[],healthReminders:true,lastHealthCheck:'2026-01-01',agreedHealthFollowUp:'' };
    try {
      await saveProfile(profile);
      const brief = await prepareProfile(profile.id);
      assert.equal(brief.status,'ready');
      assert.equal((await prepareProfile(profile.id)).id, brief.id);
      await prepareDueBriefings();
      assert.equal(searches,1);
      const sealed = await readFile(join(root,'data','senior-briefings.enc.json'),'utf8');
      assert.ok(!sealed.includes(profile.name));
      assert.ok(!sealed.includes(profile.lastHealthCheck));
      let payload;
      const result = await createCalleCall({destinationE164:'+12025550100',purpose:'Discuss the morning briefing.',idempotencyKey:'fixture-call-1234',briefingId:brief.id},process.env.CALLE_API_KEY,async (_url,init)=>{
        assert.equal(init.signal, undefined);
        payload=JSON.parse(init.body);
        return Response.json({id:'call_fixture123',status:'queued',recipients:[]});
      });
      assert.equal(result.status,'queued');
      assert.ok(payload.task.includes('Synthetic local news'));
      assert.ok(payload.task.includes('cannot browse during this phone call'));
      assert.ok(payload.task.includes('Discuss the morning briefing.'));
      assert.deepEqual(payload.recipients,[{phones:['+12025550100']}]);
      await assert.rejects(
        createCalleCall({destinationE164:'+12025550100',purpose:'Rejected fixture.',idempotencyKey:'fixture-rejected-1234'},process.env.CALLE_API_KEY,async ()=>Response.json({error:{code:'invalid_phone',message:'fixture',details:{}}}, {status:422})),
        (error) => error instanceof CalleRequestError && error.status === 422 && error.providerCode === 'invalid_phone',
      );
      await assert.rejects(
        createCalleCall({destinationE164:'+12025550100',purpose:'Rejected fixture.',idempotencyKey:'fixture-rejected-unknown'},process.env.CALLE_API_KEY,async ()=>Response.json({error:{code:'untrusted_code',message:'fixture',details:{}}}, {status:422})),
        (error) => error instanceof CalleRequestError && error.status === 422 && error.providerCode === undefined,
      );
      const fresh = await prepareProfile(profile.id,true);
      assert.notEqual(fresh.id,brief.id);
      assert.ok((await resolveBriefingTask(brief.id)).includes('Synthetic local news'));
      await saveProfile({...profile,locality:'Newcastle'});
      await assert.rejects(resolveBriefingTask(brief.id));
      const changed = await prepareProfile(profile.id);
      assert.notEqual(changed.profileFingerprint,brief.profileFingerprint);
      await assert.rejects(resolveBriefingTask(changed.id,new Date(Date.now()+2*86400000)));
      await saveProfile({...profile, consentToPersonalization:false});
      await assert.rejects(prepareProfile(profile.id));
      await deleteProfile(profile.id);
      assert.deepEqual(await readBriefingState(),{profiles:[],briefings:[]});
      console.log('offline briefing integration passed');
    } finally { process.chdir(tmpdir()); await rm(root,{recursive:true,force:true}); }
  `], { encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "offline-fixture-openai-key-not-a-real-credential" }, timeout: 30_000 });
  assert.match(output, /offline briefing integration passed/);
});
