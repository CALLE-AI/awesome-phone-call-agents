export interface ChinaVerificationResult {
  companyName: string;
  uscc: string; // Unified Social Credit Code
  legalRepresentative: string;
  status: string;
  registrationDate: string;
  registeredCapital: string;
  isVerified: boolean;
  isActive: boolean;
  source: 'mock_api' | 'could not verify';
}

export async function verifyChinaCompany(query: string): Promise<ChinaVerificationResult> {
  // Wait to simulate network latency
  await new Promise(r => setTimeout(r, 1500));

  const queryTrimmed = query.trim();
  const isUSCC = /^[0-9A-Z]{18}$/i.test(queryTrimmed); // Chinese USCCs are 18 characters alphanumeric

  if (queryTrimmed) {
    // Generate a mock USCC if a name was provided, or use the provided USCC
    const uscc = isUSCC ? queryTrimmed.toUpperCase() : '91440300' + Math.floor(1000000000 + Math.random() * 9000000000);
    const companyName = isUSCC ? `Simulated Enterprise (USCC: ${uscc})` : queryTrimmed;

    return {
      companyName: companyName,
      uscc: uscc,
      legalRepresentative: 'Wang Wei (Simulated)',
      status: '(Surviving/Active)',
      registrationDate: '2015-08-12',
      registeredCapital: '10,000,000 RMB',
      isVerified: true,
      isActive: true,
      source: 'mock_api',
    };
  }

  return {
    companyName: query,
    uscc: 'N/A',
    legalRepresentative: 'N/A',
    status: 'Could not verify',
    registrationDate: 'N/A',
    registeredCapital: 'N/A',
    isVerified: false,
    isActive: false,
    source: 'could not verify',
  };
}
