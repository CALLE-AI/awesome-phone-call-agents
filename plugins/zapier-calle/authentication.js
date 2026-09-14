import { baseUrl } from './lib/client.js';

const test = async (z, bundle) => {
  const response = await z.request({
    url: `${baseUrl(bundle)}/v1/goals`,
    params: { limit: 1 },
  });
  return response.data;
};

export default {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'CALL-E API Key',
      required: true,
      type: 'password',
      helpText:
        'Create an API key in your CALL-E account. CALL-E can place real phone calls, so treat this key as a credential.',
    },
  ],
  test,
  connectionLabel: 'CALL-E',
};
