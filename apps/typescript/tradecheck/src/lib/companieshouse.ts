// Companies House API — free UK government registry API
// Auth: HTTP Basic Auth where username = API key, password = "" (empty)
// Base URL: https://api.company-information.service.gov.uk

export interface CompaniesHouseResult {
  companyName: string;
  companyNumber: string;
  status: string;
  incorporatedOn: string;
  companyType: string;
  address?: string;
  isVerified: boolean;
  isActive: boolean;
  source: 'companies_house' | 'could not verify';
}

export async function verifyUKCompany(query: string): Promise<CompaniesHouseResult> {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    console.error('COMPANIES_HOUSE_API_KEY not set');
    return notFound(query);
  }

  // Basic auth: API key as username, empty password
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
  };

  const isCompanyNumber = /^[A-Z0-9]{2}\d{6}$|^\d{6,8}$/i.test(query.trim());

  try {
    if (isCompanyNumber) {
      // Direct profile lookup by company number
      const url = `https://api.company-information.service.gov.uk/company/${encodeURIComponent(query.trim().toUpperCase())}`;
      const res = await fetch(url, { headers });

      if (res.ok) {
        const d = await res.json();
        return mapProfile(d);
      }
    } else {
      // Search by name — pick the best match (first result)
      const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query.trim())}&items_per_page=1`;
      const res = await fetch(url, { headers });

      if (res.ok) {
        const json = await res.json();
        const item = json.items?.[0];
        if (item) {
          return {
            companyName: item.title || query,
            companyNumber: item.company_number || 'N/A',
            status: item.company_status || 'Unknown',
            incorporatedOn: item.date_of_creation || 'N/A',
            companyType: item.company_type || 'N/A',
            address: formatAddress(item.address),
            isVerified: true,
            isActive: item.company_status === 'active',
            source: 'companies_house',
          };
        }
      }
    }
  } catch (err) {
    console.error('Companies House API error:', err);
  }

  return notFound(query);
}

function mapProfile(d: Record<string, unknown>): CompaniesHouseResult {
  const addr = d.registered_office_address as Record<string, string> | undefined;
  return {
    companyName: (d.company_name as string) || 'Unknown',
    companyNumber: (d.company_number as string) || 'N/A',
    status: (d.company_status as string) || 'Unknown',
    incorporatedOn: (d.date_of_creation as string) || 'N/A',
    companyType: (d.type as string) || 'N/A',
    address: addr
      ? [addr.address_line_1, addr.address_line_2, addr.locality, addr.postal_code]
          .filter(Boolean)
          .join(', ')
      : 'N/A',
    isVerified: true,
    isActive: d.company_status === 'active',
    source: 'companies_house',
  };
}

function formatAddress(addr: Record<string, string> | undefined): string {
  if (!addr) return 'N/A';
  return [addr.address_line_1, addr.address_line_2, addr.locality, addr.postal_code]
    .filter(Boolean)
    .join(', ') || 'N/A';
}

function notFound(query: string): CompaniesHouseResult {
  return {
    companyName: query,
    companyNumber: 'N/A',
    status: 'Could not verify',
    incorporatedOn: 'N/A',
    companyType: 'N/A',
    address: 'N/A',
    isVerified: false,
    isActive: false,
    source: 'could not verify',
  };
}
