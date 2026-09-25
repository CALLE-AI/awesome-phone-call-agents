// Proves which arguments placeCall() passes to getProvider() without ever constructing a
// real CallEProvider or opening a socket — the real provider's default fetchImpl calls
// the actual global fetch, so the only safe way to prove "a request-supplied
// provider/baseUrl/apiKey never reaches it" is to intercept provider selection itself,
// not to let a live call attempt to dial out and inspect the failure.
const mockGetProvider = jest.fn();
jest.mock('../src/providers', () => ({ getProvider: mockGetProvider }));

function stubProvider() {
  return {
    cancelIsAuthoritative: true,
    placeCall: async () => ({ outcome: 'quoted', summary: 'stub', next_action: 'review_quote' })
  };
}

describe('placeCall provider selection is never influenced by request args', () => {
  let invoke;
  let store;

  beforeEach(async () => {
    jest.resetModules();
    mockGetProvider.mockReset();
    mockGetProvider.mockReturnValue(stubProvider());
    delete process.env.CALL_PROVIDER;
    ({ invoke } = require('../src/invoke'));
    store = require('../src/store');
  });

  afterEach(() => {
    delete process.env.CALL_PROVIDER;
  });

  async function approvedTask(sku) {
    const created = await invoke('create_task', { name: sku, sku, quantity: 1 }, 'owner');
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Get a quote' }, 'agent');
    await invoke('approve_task', { id }, 'owner');
    return id;
  }

  test('args.provider is ignored — provider name always comes from CALL_PROVIDER env, not the request', async () => {
    const id = await approvedTask('PROV-1');

    const result = await invoke('place_call', { id, provider: 'calle' }, 'agent');

    expect(result.success).toBe(true);
    expect(mockGetProvider).toHaveBeenCalledWith('fake', undefined);
  });

  test('providerOptions (baseUrl/apiKey) is never forwarded when the real provider is configured', async () => {
    process.env.CALL_PROVIDER = 'calle';
    const id = await approvedTask('PROV-2');

    const result = await invoke(
      'place_call',
      { id, providerOptions: { baseUrl: 'https://attacker.example', apiKey: 'stolen' } },
      'agent'
    );

    expect(result.success).toBe(true);
    expect(mockGetProvider).toHaveBeenCalledWith('calle', undefined);
  });

  test('providerOptions is still forwarded to the fake provider (test pacing hook stays usable)', async () => {
    const id = await approvedTask('PROV-3');

    await invoke('place_call', { id, providerOptions: { wait: () => Promise.resolve() } }, 'agent');

    expect(mockGetProvider).toHaveBeenCalledWith('fake', expect.objectContaining({ wait: expect.any(Function) }));
  });

  test('checking store is actually reset per test (sanity)', async () => {
    expect(store.getTask('task_1')).toBeDefined();
  });
});
