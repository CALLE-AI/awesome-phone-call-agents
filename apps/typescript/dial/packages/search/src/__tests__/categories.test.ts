import { describe, it, expect } from 'vitest';
import { resolveDomainMapping, DOMAIN_MAPPINGS, knownDomains } from '../categories.js';
import { keywordTerms } from '../osm.js';

/**
 * Written after a real failure: "find the most delicious croissant in paris"
 * was interpreted as `domain: bakery`, which had no mapping, so it fell through
 * to a name regex that Overpass could not index — 55 seconds, then a timeout,
 * surfaced to the user as "could not reach the business directory".
 */

describe('resolveDomainMapping', () => {
  it('maps bakery to real OSM tags — the case that failed', () => {
    const mapping = resolveDomainMapping('bakery', 'bakery croissant');
    expect(mapping.osmTags.length).toBeGreaterThan(0);
    expect(mapping.osmTags).toContainEqual(['shop', 'bakery']);
  });

  it('reaches a mapping through a related word', () => {
    // The interpreter will not always emit the exact domain key.
    expect(resolveDomainMapping('patisserie', 'croissant').osmTags).toContainEqual([
      'shop',
      'bakery',
    ]);
    expect(resolveDomainMapping('coffee_shop', 'coffee').osmTags).toContainEqual([
      'amenity',
      'cafe',
    ]);
  });

  it('prefers the longest keyword match, so specific beats generic', () => {
    // "shoe repair" must not lose to a shorter, vaguer keyword.
    const mapping = resolveDomainMapping('cobbler_service', 'shoe repair');
    expect(mapping.domain).toBe('shoe_repair');
  });

  it('still returns something usable for a completely unknown domain', () => {
    const mapping = resolveDomainMapping('artisanal_yo_yo_repair', 'yo-yo repair');
    expect(mapping.osmTags).toEqual([]);
    expect(mapping.keywords.length).toBeGreaterThan(0);
  });

  it('covers the domains the interpreter is told to prefer', () => {
    // The interpreter prompt lists these; a name here with no mapping would
    // send that domain straight down the slow path.
    for (const domain of knownDomains()) {
      const mapping = resolveDomainMapping(domain, domain);
      expect(mapping.osmTags.length, domain).toBeGreaterThan(0);
    }
  });

  it('has no duplicate domain keys', () => {
    const names = DOMAIN_MAPPINGS.map((m) => m.domain);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('keywordTerms', () => {
  it('splits phrases into words worth matching', () => {
    expect(keywordTerms(['bakery croissant'])).toEqual(['bakery', 'croissant']);
  });

  it('drops stopwords and filler that would match half the city', () => {
    // "the", "best", "shop" and "near" carry no signal; "me" is too short.
    expect(keywordTerms(['the best coffee shop near me'])).toEqual(['coffee']);
  });

  it('drops very short words', () => {
    expect(keywordTerms(['a to z tv repair'])).toEqual(['repair']);
  });

  it('deduplicates across phrases', () => {
    expect(keywordTerms(['bike repair', 'bike shop'])).toEqual(['bike', 'repair']);
  });

  it('returns nothing when every word is filler', () => {
    expect(keywordTerms(['the best place'])).toEqual([]);
  });
});
