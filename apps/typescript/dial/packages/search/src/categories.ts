/**
 * The domain -> provider-category mapping. This table is the reason a new
 * vertical is a config change rather than a new application (section 3).
 *
 * `osmTags` are OpenStreetMap key/value filters; `googleTypes` are Places API
 * types; `keywords` are the free-text fallback used when neither matches, so an
 * unmapped domain still returns real businesses rather than nothing.
 */

export interface DomainMapping {
  domain: string;
  osmTags: Array<[string, string]>;
  googleTypes: string[];
  keywords: string[];
}

export const DOMAIN_MAPPINGS: DomainMapping[] = [
  {
    domain: 'phone_repair',
    osmTags: [
      ['shop', 'mobile_phone'],
      ['craft', 'electronics_repair'],
      ['shop', 'electronics'],
      ['shop', 'computer'],
    ],
    googleTypes: ['electronics_store', 'store'],
    keywords: ['phone repair', 'mobile repair', 'screen repair', 'iphone repair'],
  },
  {
    domain: 'plumbing',
    osmTags: [
      ['craft', 'plumber'],
      ['shop', 'plumber'],
      ['craft', 'hvac'],
    ],
    googleTypes: ['plumber'],
    keywords: ['plumber', 'plumbing', 'emergency plumber'],
  },
  {
    domain: 'electrician',
    osmTags: [['craft', 'electrician']],
    googleTypes: ['electrician'],
    keywords: ['electrician'],
  },
  {
    domain: 'restaurant',
    osmTags: [
      ['amenity', 'restaurant'],
      ['amenity', 'bistro'],
    ],
    googleTypes: ['restaurant'],
    keywords: ['restaurant'],
  },
  {
    domain: 'pharmacy',
    osmTags: [
      ['amenity', 'pharmacy'],
      ['healthcare', 'pharmacy'],
    ],
    googleTypes: ['pharmacy', 'drugstore'],
    keywords: ['pharmacy', 'chemist'],
  },
  {
    domain: 'dentist',
    osmTags: [
      ['amenity', 'dentist'],
      ['healthcare', 'dentist'],
    ],
    googleTypes: ['dentist'],
    keywords: ['dentist', 'dental'],
  },
  {
    domain: 'doctor',
    osmTags: [
      ['amenity', 'doctors'],
      ['healthcare', 'doctor'],
    ],
    googleTypes: ['doctor'],
    keywords: ['doctor', 'gp', 'clinic'],
  },
  {
    domain: 'veterinary',
    osmTags: [['amenity', 'veterinary']],
    googleTypes: ['veterinary_care'],
    keywords: ['vet', 'veterinary'],
  },
  {
    domain: 'car_repair',
    osmTags: [
      ['shop', 'car_repair'],
      ['shop', 'tyres'],
    ],
    googleTypes: ['car_repair'],
    keywords: ['garage', 'car repair', 'mechanic'],
  },
  {
    domain: 'locksmith',
    osmTags: [
      ['shop', 'locksmith'],
      ['craft', 'locksmith'],
    ],
    googleTypes: ['locksmith'],
    keywords: ['locksmith'],
  },
  {
    domain: 'hairdresser',
    osmTags: [
      ['shop', 'hairdresser'],
      ['shop', 'beauty'],
    ],
    googleTypes: ['hair_care', 'beauty_salon'],
    keywords: ['hairdresser', 'barber', 'salon'],
  },
  {
    domain: 'hotel',
    osmTags: [
      ['tourism', 'hotel'],
      ['tourism', 'guest_house'],
    ],
    googleTypes: ['lodging'],
    keywords: ['hotel'],
  },
  {
    domain: 'optician',
    osmTags: [['shop', 'optician']],
    googleTypes: ['store'],
    keywords: ['optician', 'eye test'],
  },
  {
    domain: 'laundry',
    osmTags: [
      ['shop', 'laundry'],
      ['shop', 'dry_cleaning'],
    ],
    googleTypes: ['laundry'],
    keywords: ['laundry', 'dry cleaning'],
  },
  {
    domain: 'bakery',
    osmTags: [
      ['shop', 'bakery'],
      ['shop', 'pastry'],
      ['craft', 'bakery'],
    ],
    googleTypes: ['bakery'],
    keywords: ['bakery', 'boulangerie', 'patisserie', 'croissant', 'bread', 'cake'],
  },
  {
    domain: 'cafe',
    osmTags: [
      ['amenity', 'cafe'],
      ['shop', 'coffee'],
    ],
    googleTypes: ['cafe'],
    keywords: ['cafe', 'coffee', 'coffee shop', 'espresso'],
  },
  {
    domain: 'bar',
    osmTags: [
      ['amenity', 'bar'],
      ['amenity', 'pub'],
    ],
    googleTypes: ['bar'],
    keywords: ['bar', 'pub'],
  },
  {
    domain: 'butcher',
    osmTags: [['shop', 'butcher']],
    googleTypes: ['store'],
    keywords: ['butcher', 'meat'],
  },
  {
    domain: 'supermarket',
    osmTags: [
      ['shop', 'supermarket'],
      ['shop', 'convenience'],
      ['shop', 'greengrocer'],
    ],
    googleTypes: ['supermarket', 'grocery_store'],
    keywords: ['supermarket', 'grocery', 'groceries'],
  },
  {
    domain: 'florist',
    osmTags: [['shop', 'florist']],
    googleTypes: ['florist'],
    keywords: ['florist', 'flowers'],
  },
  {
    domain: 'gym',
    osmTags: [
      ['leisure', 'fitness_centre'],
      ['leisure', 'sports_centre'],
    ],
    googleTypes: ['gym'],
    keywords: ['gym', 'fitness', 'sports centre'],
  },
  {
    domain: 'bicycle_repair',
    osmTags: [['shop', 'bicycle']],
    googleTypes: ['bicycle_store'],
    keywords: ['bike', 'bicycle', 'cycle repair'],
  },
  {
    domain: 'shoe_repair',
    osmTags: [
      ['shop', 'shoe_repair'],
      ['craft', 'shoemaker'],
    ],
    googleTypes: ['shoe_store'],
    keywords: ['shoe repair', 'cobbler', 'heel bar'],
  },
  {
    domain: 'tailor',
    osmTags: [
      ['shop', 'tailor'],
      ['craft', 'tailor'],
      ['shop', 'sewing'],
    ],
    googleTypes: ['clothing_store'],
    keywords: ['tailor', 'alterations', 'seamstress'],
  },
  {
    domain: 'jeweller',
    osmTags: [
      ['shop', 'jewelry'],
      ['craft', 'jeweller'],
      ['shop', 'watches'],
    ],
    googleTypes: ['jewelry_store'],
    keywords: ['jeweller', 'jewelry', 'watch repair'],
  },
  {
    domain: 'bookshop',
    osmTags: [['shop', 'books']],
    googleTypes: ['book_store'],
    keywords: ['bookshop', 'bookstore', 'books'],
  },
  {
    domain: 'furniture',
    osmTags: [
      ['shop', 'furniture'],
      ['shop', 'interior_decoration'],
    ],
    googleTypes: ['furniture_store'],
    keywords: ['furniture', 'sofa', 'mattress'],
  },
  {
    domain: 'car_wash',
    osmTags: [['amenity', 'car_wash']],
    googleTypes: ['car_wash'],
    keywords: ['car wash', 'valeting'],
  },
  {
    domain: 'physiotherapy',
    osmTags: [
      ['healthcare', 'physiotherapist'],
      ['amenity', 'clinic'],
    ],
    googleTypes: ['physiotherapist'],
    keywords: ['physio', 'physiotherapy', 'chiropractor'],
  },
  {
    domain: 'spa',
    osmTags: [
      ['leisure', 'spa'],
      ['shop', 'massage'],
      ['shop', 'beauty'],
    ],
    googleTypes: ['spa', 'beauty_salon'],
    keywords: ['spa', 'massage', 'nails', 'beauty'],
  },
  {
    domain: 'childcare',
    osmTags: [
      ['amenity', 'childcare'],
      ['amenity', 'kindergarten'],
    ],
    googleTypes: ['school'],
    keywords: ['nursery', 'childcare', 'creche', 'kindergarten'],
  },
  {
    domain: 'bank',
    osmTags: [['amenity', 'bank']],
    googleTypes: ['bank'],
    keywords: ['bank', 'branch'],
  },
  {
    domain: 'post',
    osmTags: [
      ['amenity', 'post_office'],
      ['shop', 'copyshop'],
    ],
    googleTypes: ['post_office'],
    keywords: ['post office', 'parcel', 'courier'],
  },
  {
    domain: 'travel_agent',
    osmTags: [['shop', 'travel_agency']],
    googleTypes: ['travel_agency'],
    keywords: ['travel agent', 'holiday'],
  },
];

const BY_DOMAIN = new Map(DOMAIN_MAPPINGS.map((m) => [m.domain, m]));

/**
 * Resolves a domain key, falling back to a keyword-only mapping so an unmapped
 * domain still searches rather than returning an empty list.
 */
export function resolveDomainMapping(domain: string, searchQuery: string): DomainMapping {
  const direct = BY_DOMAIN.get(domain);
  if (direct) return direct;

  // Try to match on the search phrase before giving up on structured tags.
  // Longest keyword first, so "coffee shop" beats "shop" and "shoe repair"
  // beats "shoe".
  const haystack = `${domain} ${searchQuery}`.toLowerCase();
  const matches: Array<{ mapping: DomainMapping; keyword: string }> = [];
  for (const mapping of DOMAIN_MAPPINGS) {
    for (const keyword of mapping.keywords) {
      if (keyword && haystack.includes(keyword)) matches.push({ mapping, keyword });
    }
  }
  if (matches.length > 0) {
    matches.sort((a, b) => b.keyword.length - a.keyword.length);
    return matches[0]!.mapping;
  }

  return {
    domain,
    osmTags: [],
    googleTypes: [],
    keywords: [searchQuery].filter(Boolean),
  };
}

export function knownDomains(): string[] {
  return DOMAIN_MAPPINGS.map((m) => m.domain);
}
