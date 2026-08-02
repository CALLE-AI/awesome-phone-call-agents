import { describe, it, expect } from 'vitest';
import App from '../index.js';

describe('app definition', () => {
  it('registers both creates and the search', () => {
    expect(Object.keys(App.creates).sort()).toEqual(['place_call_and_wait', 'start_call']);
    expect(Object.keys(App.searches)).toEqual(['find_call_result']);
  });

  it('declares exactly the call_completed trigger, because the API has no list endpoint to poll', () => {
    expect(Object.keys(App.triggers)).toEqual(['call_completed']);
  });

  it('registers call_completed as a hook trigger', () => {
    expect(App.triggers.call_completed.operation.type).toBe('hook');
  });

  it('omits performSubscribe/performUnsubscribe on call_completed so Zapier renders a static webhook', () => {
    const operation = App.triggers.call_completed.operation;
    expect(operation.performSubscribe).toBeUndefined();
    expect(operation.performUnsubscribe).toBeUndefined();
  });

  it('wires the bearer middleware and error handler', () => {
    expect(App.beforeRequest).toHaveLength(1);
    expect(App.afterResponse).toHaveLength(1);
  });

  it('uses custom authentication with a password-typed key field', () => {
    expect(App.authentication.type).toBe('custom');
    expect(App.authentication.fields[0].type).toBe('password');
  });

  it('uses only display properties the Zapier schema allows', () => {
    const allowed = new Set(['label', 'description', 'directions', 'hidden']);
    const actions = [
      ...Object.values(App.creates),
      ...Object.values(App.searches),
    ];
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      for (const key of Object.keys(action.display)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it('gives every action a distinct label and a description', () => {
    const actions = [...Object.values(App.creates), ...Object.values(App.searches)];
    const labels = actions.map((action) => action.display.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const action of actions) {
      expect(typeof action.display.description).toBe('string');
      expect(action.display.description.length).toBeGreaterThan(20);
    }
  });

  it('declares a version matching package.json', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(App.version).toBe(pkg.version);
  });

  it('declares ESM with an exports map, which the Zapier wrapper requires', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.type).toBe('module');
    expect(pkg.exports).toEqual({ '.': './index.js' });
  });
});
