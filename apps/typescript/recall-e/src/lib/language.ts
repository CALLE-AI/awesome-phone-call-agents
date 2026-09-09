// Shared first-language -> flag emoji lookup (resident onboarding form,
// generated resident/call data).

const LANGUAGE_FLAGS: Record<string, string> = {
  english: '🇺🇸',
  spanish: '🇪🇸',
  italian: '🇮🇹',
  french: '🇫🇷',
  german: '🇩🇪',
  mandarin: '🇨🇳',
  chinese: '🇨🇳',
  tagalog: '🇵🇭',
  filipino: '🇵🇭',
};

export function getLanguageFlag(language: string): string {
  const lower = language.toLowerCase();
  const match = Object.keys(LANGUAGE_FLAGS).find((key) => lower.includes(key));
  return match ? LANGUAGE_FLAGS[match] : '🇺🇸';
}
