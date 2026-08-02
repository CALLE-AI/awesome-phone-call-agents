import { describe, it, expect } from 'vitest';
import App from '../index.js';

describe('app definition', () => {
  it('registers both creates and the search', () => {
    expect(Object.keys(App.creates).sort()).toEqual(['place_call_and_wait', 'start_call']);
    expect(Object.keys(App.searches)).toEqual(['find_call_result']);
  });

  it('declares no triggers, because the API has no list endpoint to poll', () => {
    expect(App.triggers).toEqual({});
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

  it('does not declare "type": "module", which breaks the Zapier build wrapper', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.type).toBeUndefined();
  });
});
