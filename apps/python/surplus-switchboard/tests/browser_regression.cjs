// Optional browser checks: start app.py, then run with an installed Playwright.
// node tests/browser_regression.cjs http://127.0.0.1:8791 evidence/browser
// PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE may point to existing local runtimes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url=process.argv[2] || 'http://127.0.0.1:8791';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))throw Error('Only a loopback demo is allowed');
const output=path.resolve(process.argv[3] || 'evidence/browser');
fs.mkdirSync(output,{recursive:true});
const receipt={started_at:new Date().toISOString(),scope:'Actual local UI; fictional inputs; no CALL-E requests',checks:[],page_errors:[]};
let browser;
(async()=>{
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});
  page.on('pageerror',e=>receipt.page_errors.push(String(e)));
  await page.goto(url);
  const input=page.locator('#input'),run=page.locator('#run'),reset=page.locator('#reset'),download=page.locator('#download');
  const complete=()=>page.waitForFunction(()=>!document.getElementById('run').disabled);
  const cleared=async()=>{
   assert.equal(await download.isDisabled(),true);
   assert.equal(await page.locator('#metrics').innerText(),'');
   assert.equal(await page.locator('#detail').innerText(),'');
   assert.match(await page.locator('#raw').textContent(),/^No result for the current inputs/);
  };
  const sample=JSON.parse(await input.inputValue());
  await run.click();await complete();
  assert.match(await page.locator('#status').innerText(),/Python computation completed/);
  assert.equal(await download.isEnabled(),true);
  assert.match(await page.locator('#metrics').innerText(),/12/);
  const pendingDownload=page.waitForEvent('download');await download.click();
  const artifact=await pendingDownload;
  await artifact.saveAs(path.join(output,'browser_result.json'));
  const result=JSON.parse(fs.readFileSync(path.join(output,'browser_result.json'),'utf8'));
  assert.equal(result.portions,12);assert.equal(result.nearest_first_baseline.portions,6);
  receipt.checks.push('Actual optimizer computation and JSON download');
  await page.screenshot({path:path.join(output,'browser_valid.png'),fullPage:true});

  await input.fill('{invalid');await cleared();
  receipt.checks.push('Editing invalidates the prior result and download immediately');
  await run.click();await complete();await cleared();
  assert.match(await page.locator('#status').getAttribute('class'),/error/);
  receipt.checks.push('Invalid JSON run leaves no stale proposal or downloadable result');
  await page.screenshot({path:path.join(output,'browser_invalid.png'),fullPage:true});

  await reset.click();assert.equal(await download.isEnabled(),true);
  await input.fill('{}');await run.click();await complete();await cleared();
  assert.match(await page.locator('#status').getAttribute('class'),/error/);
  receipt.checks.push('HTTP validation failure leaves no stale result');

  await reset.click();
  let release,requested;
  let gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>requested=resolve);
  await page.route('**/solve',async route=>{requested();await gate;await route.continue();});
  await run.click();await started;await cleared();
  await input.fill('{edited while waiting');release();await complete();await cleared();
  assert.match(await page.locator('#status').innerText(),/Inputs changed/);
  receipt.checks.push('An actual response arriving after edits cannot restore the old result');
  await page.unroute('**/solve');

  await reset.click();const changed=structuredClone(sample);changed.partners[0].capacity=1;
  await input.fill(JSON.stringify(changed));
  gate=new Promise(resolve=>release=resolve);started=new Promise(resolve=>requested=resolve);
  await page.route('**/solve',async route=>{requested();await gate;await route.continue();});
  await run.click();await started;await reset.click();release();await complete();
  assert.equal(JSON.parse(await page.locator('#raw').textContent()).portions,12);
  assert.match(await page.locator('#status').innerText(),/Bundled/);
  receipt.checks.push('Reset invalidates an older pending response and preserves the bundled result');
  await page.unroute('**/solve');

  await page.route('**/solve',route=>route.abort('failed'));
  await run.click();await complete();await cleared();
  assert.match(await page.locator('#status').getAttribute('class'),/error/);
  receipt.checks.push('Network failure leaves no stale result');
  await page.unroute('**/solve');
  assert.deepEqual(receipt.page_errors,[]);receipt.passed=true;
 }catch(error){receipt.passed=false;receipt.error=String(error);process.exitCode=1;}
 finally{
  if(browser)await browser.close();
  receipt.finished_at=new Date().toISOString();
  fs.writeFileSync(path.join(output,'browser_verification.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
 }
})();
