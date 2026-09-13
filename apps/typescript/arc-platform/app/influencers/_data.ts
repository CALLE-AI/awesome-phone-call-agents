export type Platform = "instagram" | "tiktok" | "youtube" | "snapchat";

export interface Creator {
  id: string;
  username: string;
  displayName: string;
  platforms: Platform[];
  primaryPlatform: Platform;
  niche: string[];
  city: string;
  followers: number;
  allFollowers: { platform: Platform; count: number }[];
  engagementRate: number;
  avgViews: number;
  audienceFemale: number;
  audienceAgeRange: string;
  audienceCities: string[];
  pricePost: number;
  priceStory: number;
  priceVideo?: number;
  priceShorts?: number;
  isVerified: boolean;
  isAvailableNow: boolean;
  languages: string[];
  bio: string;
  contentTypes: string[];
  responseTime: string;
  aiMatchScore: number;
  aiMatchRationale: string;
  demographics: {
    age: { label: string; value: number }[];
    topCities: { city: string; pct: number }[];
  };
}

/**
 * Empty, on purpose.
 *
 * Eight creators used to be written out here by hand - real-looking handles
 * (@zarakhan_official, @pakistanfoodielife, @cricket_talks_pk), first-person
 * bios, follower counts, engagement rates, per-post prices, star ratings and
 * testimonials quoting Khaadi and Shan Foods. Nothing in the repository
 * recorded where any of it came from, and nothing established whether those
 * accounts belong to real people.
 *
 * That uncertainty is the whole reason they are gone. If the handles were
 * invented, removing them costs nothing. If even one belonged to a real
 * person, then this product was publishing that person's commercial terms -
 * their rate, their engagement, their reviews - without their knowledge, and
 * an "estimate" label would not have fixed it. The risk is one-sided, so the
 * decision is one-sided.
 *
 * Creators now come from the Contact table, seeded from
 * docs/arc-creator-catalogue-demo.csv: twenty-four personas written for this
 * demo, named as such on the directory. A creator here would override that,
 * which is why the list stays empty rather than being repopulated.
 */
export const CREATORS: Creator[] = [];

export function getCreator(username: string): Creator | undefined {
  return CREATORS.find(c => c.username === username);
}

export const ALL_NICHES = [
  "FMCG", "Food", "Fashion", "Modest Fashion", "Parenting", "Lifestyle",
  "Wellness", "Beauty", "Sports", "Cricket", "Islamic Content",
  "Cooking", "Restaurant Reviews", "Travel", "Tech", "Gaming",
  "Finance", "Education", "Comedy", "Music",
];

export const ALL_CITIES = ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar"];
