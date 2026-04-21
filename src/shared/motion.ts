// Shared framer-motion variants for the redesign. Every animation used across
// the app lives here so the motion language is consistent + `reduced motion`
// kill-switch applies centrally (wrap App in <MotionConfig reducedMotion="user">).

import type { Transition, Variants } from "framer-motion";

export const EASE = [0.25, 0.8, 0.25, 1] as const;

export const DURATION = {
  fast: 0.15,
  base: 0.22,
  slow: 0.38,
  hero: 0.56,
} as const;

export const springy: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 28,
  mass: 0.6,
};

export const fadeIn: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.base, ease: EASE } },
  exit:    { opacity: 0, transition: { duration: DURATION.fast, ease: EASE } },
};

export const fadeInUp: Variants = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
  exit:    { opacity: 0, y: 8, transition: { duration: DURATION.fast, ease: EASE } },
};

export const slideIn: Variants = {
  hidden:  { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: { duration: DURATION.base, ease: EASE } },
  exit:    { opacity: 0, x: 12, transition: { duration: DURATION.fast, ease: EASE } },
};

export const cardHover: Variants = {
  rest:  { y: 0, transition: { duration: DURATION.fast, ease: EASE } },
  hover: { y: -2, transition: { duration: DURATION.fast, ease: EASE } },
  tap:   { y: 1,  transition: { duration: DURATION.fast, ease: EASE } },
};

export const pagePop: Variants = {
  hidden:  { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: { duration: DURATION.slow, ease: EASE } },
  exit:    { opacity: 0, scale: 0.99, transition: { duration: DURATION.fast, ease: EASE } },
};

export const stagger = (delay = 0.04): Variants => ({
  hidden:  {},
  visible: { transition: { staggerChildren: delay, delayChildren: 0.04 } },
});
