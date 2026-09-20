// Shared speech-synthesis tuning used anywhere CALL-E turns are read aloud
// (CallDetailModal's transcript playback, LiveCallSimulatorModal's live call).

export function getSpeechLangCode(language: string): string {
  const lower = language.toLowerCase();
  if (lower.includes('span')) return 'es-MX';
  if (lower.includes('ital')) return 'it-IT';
  if (lower.includes('fren')) return 'fr-FR';
  return 'en-US';
}

export function getSpeechVoiceParams(isCallee: boolean): { rate: number; pitch: number } {
  // CALL-E: warm, deliberate pacing. Resident: slower elderly cadence.
  return isCallee ? { rate: 0.92, pitch: 1.05 } : { rate: 0.85, pitch: 0.95 };
}
