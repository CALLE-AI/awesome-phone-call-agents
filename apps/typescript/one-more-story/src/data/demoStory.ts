export type StoryStage = 'ready' | 'disclosure' | 'permission' | 'question' | 'readback' | 'correction' | 'confirmed' | 'private' | 'published' | 'deleted'
export const stageOrder: StoryStage[] = ['ready', 'disclosure', 'permission', 'question', 'readback', 'correction', 'confirmed', 'private', 'published', 'deleted']
export const demoStory = {
  title: 'The rose market before sunrise',
  question: 'What did the rose market smell like when you were young?',
  originalAnswer: 'It smelled like wet paper, green leaves, and a little sugar from the tea shop. The air was cool, and the roses had just arrived from the hills.',
  correction: 'Mint leaves, not green leaves.',
  correctedAnswer: 'It smelled like wet paper, mint leaves, and a little sugar from the tea shop. The air was cool, and the roses had just arrived from the hills.',
} as const
