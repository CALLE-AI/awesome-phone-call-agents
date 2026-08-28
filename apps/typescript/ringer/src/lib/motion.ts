import type { Variants } from 'motion/react'

/** Fade + rise, used for entrances. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
}

/** Container that staggers its children's entrance. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
}

/** Gentle cross-fade for switching top-level views. */
export const viewFade: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.18, ease: 'easeIn' } },
}

/** Pop used for the outcome reveal. */
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
}
