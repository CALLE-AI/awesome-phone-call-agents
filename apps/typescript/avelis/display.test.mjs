import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {displayJSON} from './src/display.mjs';

test('console copies mask transcript, structured and model phone text without changing evidence',()=>{
 const evidence={transcript:'Callback +12025550123',provider_structured_result:{notes:['Use (202) 555-0123']},model:{draft:'Reach +1 202 555 0123'},score:0.75,requestNumber:123456789};
 const before=structuredClone(evidence),output=displayJSON(evidence);
 assert.doesNotMatch(output,/12025550123|202\) 555-0123|202 555 0123/);
 assert.equal((output.match(/\[phone masked\]/g)||[]).length,3);
 assert.equal(JSON.parse(output).score,0.75);
 assert.equal(JSON.parse(output).requestNumber,123456789);
 assert.deepEqual(evidence,before);
});
test('inspection and model CLI serializations use the display-only boundary',()=>{
 const source=readFileSync(new URL('./app.mjs',import.meta.url),'utf8');
 assert.match(source,/console\.log\(displayJSON\(await modelWorkflow/);
 assert.match(source,/console\.log\(displayJSON\(\{mode:'Read-only CALL-E inspection'/);
});
