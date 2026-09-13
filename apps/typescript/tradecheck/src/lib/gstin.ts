export interface GSTINResult {
  legalName: string;
  status: string;
  registrationDate: string;
  state: string;
  pan: string;
  isVerified: boolean;
  source: 'sandbox' | 'gstinapi' | 'error';
}

export async function verifyGSTIN(gstin: string): Promise<GSTINResult> {
  // Try Sandbox GST API first
  try {
    const sandboxRes = await fetch('https://api.sandbox.co.in/gst/compliance/public/gstin/verify', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.SANDBOX_API_KEY || '',
        'Authorization': process.env.SANDBOX_AUTH_TOKEN || '',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ gstin })
    });
    
    if (sandboxRes.ok) {
      const data = await sandboxRes.json();
      return {
        legalName: data.data?.lgnm || 'Unknown',
        status: data.data?.sts || 'Unknown',
        registrationDate: data.data?.rgdt || 'Unknown',
        state: data.data?.pradr?.addr?.stcd || 'Unknown',
        pan: gstin.substring(2, 12),
        isVerified: data.data?.sts === 'Active',
        source: 'sandbox'
      };
    }
  } catch (err) {
    console.error("Sandbox API failed:", err);
  }

  // Fallback to gstinapi.in
  try {
    const fallbackRes = await fetch(`https://api.gstinapi.in/v1/verify?gstin=${gstin}`, {
      headers: {
        'Authorization': `Bearer ${process.env.GSTIN_API_KEY || ''}`
      }
    });

    if (fallbackRes.ok) {
      const data = await fallbackRes.json();
      return {
        legalName: data.legalName || 'Unknown',
        status: data.status || 'Unknown',
        registrationDate: data.registrationDate || 'Unknown',
        state: data.state || 'Unknown',
        pan: gstin.substring(2, 12),
        isVerified: data.status === 'Active',
        source: 'gstinapi'
      };
    }
  } catch (err) {
    console.error("Fallback API failed:", err);
  }

  return {
    legalName: '',
    status: 'Failed',
    registrationDate: '',
    state: '',
    pan: '',
    isVerified: false,
    source: 'error'
  };
}
