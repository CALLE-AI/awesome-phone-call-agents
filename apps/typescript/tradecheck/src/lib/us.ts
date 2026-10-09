/**
 * US Company Verification via SEC EDGAR
 *
 * Uses the SEC's public EDGAR full-text search API to locate a company by name or EIN,
 * then fetches its full submission record for authoritative registration details.
 *
 * Both endpoints are free, require no API key, and are officially maintained by the SEC.
 * Rate-limit: 10 requests/second per IP. We stay well under this.
 *
 * Docs: https://efts.sec.gov/LATEST/search-index (search)
 *       https://data.sec.gov/submissions/CIK{10-digit-zero-padded}.json (submissions)
 */

export interface USVerificationResult {
  companyName: string;
  ein: string;
  cik: string;
  stateOfIncorporation: string;
  businessAddress: string;
  entityType: string;
  sicDescription: string;
  tickers: string[];
  exchanges: string[];
  phone: string;
  formerNames: string[];
  status: string;
  isVerified: boolean;
  isActive: boolean;
  source: 'sec_edgar' | 'could not verify';
}

const EDGAR_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index';
const EDGAR_SUBMISSIONS_URL = 'https://data.sec.gov/submissions';

// SEC requires a descriptive User-Agent for all API requests.
const SEC_USER_AGENT = 'TradeCheck/1.0 (contact@tradecheck.app)';

async function searchByCIK(query: string): Promise<string | null> {
  // If the query looks like a CIK (up to 10 digits), use it directly.
  if (/^\d{1,10}$/.test(query.trim())) {
    return query.trim().padStart(10, '0');
  }

  // Otherwise, search by company name using EDGAR full-text search.
  // We search for entity name matches using the dedicated company search endpoint.
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${query}"`)}&forms=10-K,10-Q,S-1,DEF%2014A`;
  const res = await fetch(url, {
    headers: { 'User-Agent': SEC_USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
  });

  if (!res.ok) return null;

  const data = await res.json();
  const hits = data?.hits?.hits ?? [];
  if (hits.length === 0) return null;

  // Return the CIK from the top result.
  const ciks: string[] = hits[0]?._source?.ciks ?? [];
  if (ciks.length === 0) return null;

  return ciks[0].padStart(10, '0');
}

async function fetchSubmissions(cik: string): Promise<USVerificationResult> {
  const url = `${EDGAR_SUBMISSIONS_URL}/CIK${cik}.json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': SEC_USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
  });

  if (!res.ok) {
    throw new Error(`EDGAR submissions fetch failed: ${res.status}`);
  }

  const d = await res.json();

  const addressParts = [
    d.addresses?.business?.street1,
    d.addresses?.business?.street2,
    d.addresses?.business?.city,
    d.addresses?.business?.stateOrCountryDescription,
    d.addresses?.business?.zipCode,
  ].filter(Boolean);

  const formerNames: string[] = (d.formerNames ?? []).map(
    (f: { name: string }) => f.name
  );

  // EDGAR doesn't report "active/inactive" directly, but the presence of
  // recent filings indicates an active registrant. We use entityType as a proxy.
  const isActive = !!d.entityType && d.entityType !== '';

  return {
    companyName: d.name ?? 'Unknown',
    ein: d.ein ? `${d.ein.substring(0, 2)}-${d.ein.substring(2)}` : 'Not disclosed',
    cik: d.cik ?? cik,
    stateOfIncorporation: d.stateOfIncorporationDescription ?? d.stateOfIncorporation ?? 'N/A',
    businessAddress: addressParts.join(', ') || 'N/A',
    entityType: d.entityType ?? 'N/A',
    sicDescription: d.sicDescription ?? 'N/A',
    tickers: d.tickers ?? [],
    exchanges: d.exchanges ?? [],
    phone: d.phone ?? 'N/A',
    formerNames,
    status: isActive ? 'Active SEC Registrant' : 'Inactive / Not found',
    isVerified: true,
    isActive,
    source: 'sec_edgar',
  };
}

export async function verifyUSCompany(query: string): Promise<USVerificationResult> {
  const trimmed = query.trim();

  try {
    const cik = await searchByCIK(trimmed);

    if (!cik) {
      return {
        companyName: trimmed,
        ein: 'N/A',
        cik: 'N/A',
        stateOfIncorporation: 'N/A',
        businessAddress: 'N/A',
        entityType: 'N/A',
        sicDescription: 'N/A',
        tickers: [],
        exchanges: [],
        phone: 'N/A',
        formerNames: [],
        status: 'Not found in SEC EDGAR',
        isVerified: false,
        isActive: false,
        source: 'could not verify',
      };
    }

    return await fetchSubmissions(cik);
  } catch (err) {
    console.error('[US] EDGAR lookup error:', err);
    return {
      companyName: trimmed,
      ein: 'N/A',
      cik: 'N/A',
      stateOfIncorporation: 'N/A',
      businessAddress: 'N/A',
      entityType: 'N/A',
      sicDescription: 'N/A',
      tickers: [],
      exchanges: [],
      phone: 'N/A',
      formerNames: [],
      status: 'Could not verify — EDGAR lookup failed',
      isVerified: false,
      isActive: false,
      source: 'could not verify',
    };
  }
}
