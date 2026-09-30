// Run in the dedicated Playwright CLI session against a built local prototype:
// playwright-cli -s=callops-ui01 run-code --filename scripts/workshop-browser-qa.js
async (page) => {
  const checks = [];
  const errors = [];
  const external = [];
  const origin = await page.evaluate(() => location.origin);
  const assert = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (!request.url().startsWith(`${origin}/`)) external.push(request.url()); });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('callops.workshop.snapshot.v1')));
  const overflow = async (name) => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name);
  const fresh = async () => {
    if (await button('New simulation').count()) await button('New simulation').click();
    await page.getByRole('heading', { name: 'Follow up with confidence.' }).waitFor();
  };
  await fresh();
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await overflow(`Case has no horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'output/playwright/ui01-case-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/ui01-case-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const scenario of [
    { radio: 'Part expected · return unknown', outcome: 'The return date is still unconfirmed', state: 'COMPLETED' },
    { radio: 'Repair ready · return confirmed', outcome: 'The return date is confirmed', state: 'COMPLETED' },
    { radio: 'Conflicting supplier dates', outcome: 'The supplier gave conflicting return information', state: 'COMPLETED' },
    { radio: 'Supplier unreachable', outcome: 'No supplier update obtained', state: 'FAILED' },
  ]) {
    await fresh();
    await page.getByRole('radio', { name: new RegExp(`^${scenario.radio}`) }).check();
    await button('Review the call').click();
    assert(await button('Approve brief').isDisabled(), `${scenario.radio}: approval initially disabled`);
    if (scenario.radio.startsWith('Part')) {
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await overflow(`Call review has no horizontal overflow at ${width}px`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: 'output/playwright/ui01-review-desktop.png', fullPage: true });
    }
    await page.getByRole('checkbox').check();
    await button('Approve brief').click();
    if (scenario.radio.startsWith('Part')) {
      await button('+ Add an extra date clarification').click();
      assert(await button('Approve brief').isDisabled(), 'Changed brief invalidates approval and unchecks consent');
      assert((await saved()).approval === null, 'Changed approval is also invalidated in saved state');
      await page.reload();
      await page.getByRole('checkbox').waitFor();
      assert(await button('Approve brief').isDisabled(), 'Reload does not re-approve a changed brief');
      await page.getByRole('checkbox').check();
      await button('Approve brief').click();
    }
    await button('Run simulation').evaluate((element) => { element.click(); element.click(); });
    await button('Read supplier response').waitFor();
    await page.reload();
    await button('Read supplier response').click();
    await button('View the result').waitFor();
    await page.reload();
    await button('View the result').click();
    await page.getByRole('heading', { name: scenario.outcome, exact: true }).waitFor();
    let current = await saved();
    assert(current.run.state === scenario.state, `${scenario.radio}: correct terminal state`);
    assert(current.audit.filter((item) => item.newState === 'QUEUED').length === 1, `${scenario.radio}: one start across double click and reloads`);
    assert(current.run.retryScheduled === false, `${scenario.radio}: no automatic retry`);
    for (const width of [1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await overflow(`${scenario.radio}: result has no horizontal overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    if (scenario.radio.startsWith('Part')) {
      const input = page.getByRole('textbox');
      const original = await input.inputValue();
      assert(original.includes('expects the part') && original.includes('not yet have a confirmed date'), 'Central draft preserves the estimate and unknown return');
      await page.getByRole('link', { name: 'Evidence E4 for Device return' }).click();
      assert(await page.locator('#supplier-evidence').evaluate((element) => element.open), 'Date citation opens its transcript evidence');
      assert(await page.locator('#E4').innerText().then((text) => text.includes('Device return is not confirmed')), 'Date citation points to the correct source');
      await page.locator('#supplier-evidence').evaluate((element) => { element.open = false; });
      await input.fill('A manually edited fictional update.');
      assert(await page.locator('#draft-status').innerText().then((text) => text.includes('Edited by you')), 'Manual draft loses the generated-evidence claim');
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__ui01Copied = text; } } });
      });
      await button('Copy customer update').click();
      assert(await page.evaluate(() => window.__ui01Copied === 'A manually edited fictional update.'), 'Copy action uses the edited text without touching the system clipboard in QA');
      await button('Restore suggestion').click();
      assert(await page.getByRole('textbox').inputValue() === original, 'Original evidence-backed suggestion can be restored');
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('QA denial'); } } });
      });
      await button('Copy customer update').click();
      assert(await page.getByRole('textbox').evaluate((element) => element.selectionEnd - element.selectionStart === element.value.length), 'Clipboard denial selects the draft for manual copy');
      await page.reload();
      await page.getByRole('textbox').waitFor();
      current = await saved();
      assert(current.run.state === 'COMPLETED', 'Result survives reload without restarting');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: 'output/playwright/ui01-result-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: 'output/playwright/ui01-result-mobile.png', fullPage: true });
    }
  }
  await fresh();
  await button('Review the call').click();
  await button('Reject brief').click();
  await page.reload();
  await page.getByRole('heading', { name: 'The brief was rejected' }).waitFor();
  assert(await button('Run simulation').count() === 0, 'Rejected brief cannot run after reload');
  await page.evaluate(() => localStorage.setItem('callops.workshop.snapshot.v1', '{invalid'));
  await page.reload();
  await page.getByRole('heading', { name: 'Your saved session needs attention.' }).waitFor();
  await button('Use a temporary session').click();
  await page.getByRole('heading', { name: 'Follow up with confidence.' }).waitFor();
  assert(await page.evaluate(() => localStorage.getItem('callops.workshop.snapshot.v1')) === '{invalid', 'Temporary mode leaves unavailable saved state untouched');
  await page.reload();
  await button('Clear workshop session').click();
  await page.getByRole('heading', { name: 'Follow up with confidence.' }).waitFor();
  assert(await page.evaluate(() => localStorage.getItem('callops.workshop.snapshot.v1')) === null, 'Explicit reset clears only the workshop session');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('QA full storage', 'QuotaExceededError'); }; });
  await button('Review the call').click();
  await button('Use a temporary session').click();
  await button('Review the call').click();
  await page.getByRole('checkbox').waitFor();
  assert(await button('Approve brief').isDisabled(), 'Storage write failure offers a working temporary session with a fresh approval');
  await page.reload();
  await page.getByRole('heading', { name: 'Follow up with confidence.' }).waitFor();
  assert(errors.length === 0, `No page errors: ${errors.join('; ')}`);
  assert(external.length === 0, `No external browser requests: ${external.join('; ')}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  return { status: 'PASS', checks, pageErrors: errors, externalRequests: external };
}
