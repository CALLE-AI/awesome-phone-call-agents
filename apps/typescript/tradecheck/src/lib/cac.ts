// apify-client SDK not used here — we call the Apify Actor REST API directly via fetch

export interface CACResult {
  companyName: string;
  rcNumber: string;
  status: string;
  registrationDate: string;
  companyType: string;
  address?: string;
  isVerified: boolean;
  isActive?: boolean;
  source: 'rapidapi' | 'apify' | 'could not verify';
}

export async function verifyCACCompany(query: string): Promise<CACResult> {

  try {
    const rapidapiKey = process.env.RAPIDAPI_KEY;
    // const rapidapiHost = process.env.RAPIDAPI_HOST;
    if (!rapidapiKey) throw new Error('RAPIDAPI_KEY not set');
    
    // Determine if query looks like an RC number (numeric) or company name
    const isRCNumber = /^\d+$/.test(query.trim());
    const url = isRCNumber? `https://business-and-company-name-api.p.rapidapi.com/api/v1/cacctrlsrvc/companies/searchbyreg?regNumber=RC%20-%20${query}`
      :`https://business-and-company-name-api.p.rapidapi.com/api/v1/cacctrlsrvc/companies/searchbyname?companyName=${query}&limit=10&page=1`;
    const options = {
      method: 'GET',
      headers: {
        'x-rapidapi-key': rapidapiKey,
        'x-rapidapi-host': 'business-and-company-name-api.p.rapidapi.com',
        'Content-Type': 'application/json'
      }
    };
    
    const res = await fetch(url, options);
    if (res.ok) {
      const json = await res.json();
      
      // If the API itself is down but RapidAPI returns 200 with an error payload:
      if (json.messages && typeof json.messages === 'string' && json.messages.includes('unreachable')) {
        throw new Error(`RapidAPI Upstream Error: ${json.messages}`);
      }
      
      let d = json.entity || json.data || json;
      // If the result is an array (e.g. search by name returns multiple), pick the first one
      if (Array.isArray(d)) {
        d = d[0];
      }

      if (d) {
        return {
          companyName: d.company_name || d.companyName || query,
          rcNumber: d.rc_number || d.rcNumber || d.regNumber || 'N/A',
          status: d.status || 'Registered',
          registrationDate: d.registration_date || d.registrationDate || 'N/A',
          companyType: d.company_type || d.companyType || 'N/A',
          address: d.address || d.registered_address || d.branchAddress || 'N/A',
          isVerified: true,
          isActive: d.isActive,
          source: 'rapidapi',
        };
      }
    }
  } catch (err) {
    console.error('Rapidapi CAC lookup failed: ', err)
  }

  try {
    const apifyToken = process.env.APIFY_API_KEY;
    if (!apifyToken) throw new Error('APIFY_API_KEY not set');
 
    const isRCNumber = /^\d+$/.test(query.trim());
    const input = isRCNumber
      ? { registrationNumbers: [`RC ${query.trim()}`], maxResultsPerQuery: 1 }
      : { companyNames: [query.trim()], maxResultsPerQuery: 10, nameMatchMode: 'relevant' };
 
    const url = `https://api.apify.com/v2/acts/regdata~nigeria-cac-company-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=60`;
 
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
 
    if (res.ok) {
      const items = await res.json(); // array of dataset rows
      const d = Array.isArray(items) ? items[0] : items;
 
      if (d) {
        return {
          companyName: d.approvedName || query,
          rcNumber: d.registrationNumberFormatted || 'N/A',
          status: d.status || 'Registered',
          registrationDate: d.registrationDate || 'N/A',
          companyType: d.classificationLabel || 'N/A',
          isVerified: true,
          isActive: d.status === 'ACTIVE',
          source: 'apify',
        };
      }
    }
    
  } catch (err) {
    console.error('Apify CAC lookup failed: ', err)
  }
  

  return {
    companyName: query,
    rcNumber: 'N/A',
    status: 'Could not verify',
    registrationDate: 'N/A',
    companyType: 'N/A',
    address: 'N/A',
    isVerified: false,
    source: 'could not verify',
  };
}
