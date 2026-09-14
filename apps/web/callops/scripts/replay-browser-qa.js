// Playwright CLI run-code routine. Serve the built local candidate first.
async (page) => {
  const checks = [];
  const errors = [];
  const external = [];
  const origin = await page.evaluate(() => location.origin);
  const assert = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (!request.url().startsWith(`${origin}/`)) external.push(request.url()); });
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  await page.goto(`${origin}/replay.html`);
  await page.getByRole('heading', { name: 'See what supports the update.' }).waitFor();
  assert(await page.getByText('Synthetic replay fixtures', { exact: true }).isVisible(), 'Synthetic mode is visible before any evidence claim');
  assert(await page.locator('input, textarea, form').count() === 0, 'Reader contains no upload, input or call form');
  for (const [label, expected] of [
    ['Part expected · return unknown', 'The return date is still unconfirmed'],
    ['Repair ready · return confirmed', 'The return date is confirmed'],
    ['Conflicting supplier dates', 'The supplier gave conflicting return information'],
    ['Supplier unreachable', 'No supplier update obtained'],
  ]) {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.click();
    await page.getByRole('heading', { name: expected, exact: true }).waitFor();
    assert(await button.getAttribute('aria-pressed') === 'true', `${label}: selected state and result agree`);
    assert(await page.locator('.date-card').count() === 4, `${label}: four date meanings remain visible`);
  }
  await page.getByRole('button', { name: 'Part expected · return unknown', exact: true }).click();
  assert((await page.locator('[data-kind="PART_ARRIVAL"]').innerText()).includes('Estimated'), 'Friday part arrival remains estimated');
  assert((await page.locator('[data-kind="DEVICE_RETURN"]').innerText()).includes('Not confirmed'), 'Friday part arrival does not become a confirmed return');
  await page.locator('[data-kind="PART_ARRIVAL"] a').first().click();
  assert(await page.locator('#evidence').evaluate((node) => node.open), 'Date reference opens the scripted evidence');
  assert(await page.evaluate(() => document.activeElement?.id) === 'E2', 'Date reference focuses its correct source excerpt');
  await page.locator('.replay-draft a[data-source="CASE"]').click();
  assert(await page.evaluate(() => document.activeElement?.id) === 'CASE', 'Draft reference focuses the case expectation');
  await page.locator('.replay-provenance summary').click();
  assert((await page.locator('.replay-provenance').innerText()).includes('0 service requests · 0 phone calls'), 'Provenance never presents the fixtures as real calls');
  assert((await page.locator('.replay-provenance').innerText()).includes('not a signature'), 'Integrity and authenticity are distinguished');
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Reader has no horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'output/playwright/r6a-replay-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/r6a-replay-mobile.png', fullPage: true });
  await page.route('**/assets/*.js', async (route) => {
    const response = await route.fetch();
    const text = (await response.text()).replaceAll('5f0c5a2059ebb4b58da36c50e2f5865e7b07b4a894da4f0d070f39e17beb45aa', '0'.repeat(64));
    await route.fulfill({ response, body: text });
  });
  await page.reload();
  await page.getByRole('alert').waitFor();
  assert(await page.locator('.date-card').count() === 0, 'Tampered bundle shows no unverified result');
  assert((await page.getByRole('alert').innerText()).includes('REPLAY_INTEGRITY_MISMATCH'), 'Tampered catalog hash produces the explicit closed state');
  await page.unroute('**/assets/*.js');
  await page.reload();
  await page.getByRole('heading', { name: 'See what supports the update.' }).waitFor();
  assert(await page.evaluate(() => JSON.stringify(localStorage)) === storage, 'Reader leaves browser storage unchanged');
  assert(errors.length === 0, 'No page errors');
  assert(external.length === 0, 'No external requests');
  await page.setViewportSize({ width: 1280, height: 900 });
  return { status: 'PASS', checks, pageErrors: errors, externalRequests: external };
}
