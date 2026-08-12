export type StoryDecision = {
  confirmed: boolean
  correctedAnswer: string | null
}

export function applyCorrection(originalAnswer: string, correction: string): StoryDecision {
  const normalized = correction.trim().toLowerCase()
  if (!normalized.includes('mint')) {
    return { confirmed: false, correctedAnswer: null }
  }

  return {
    confirmed: true,
    correctedAnswer: originalAnswer.replace(/green leaves/gi, 'mint leaves'),
  }
}
