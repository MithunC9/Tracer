'use client';
import { motion, useReducedMotion } from 'motion/react';
import type { ElementType, ReactNode } from 'react';
import { motion as m, motionEase } from '../tokens.js';

export interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Delay before the first item, ms. */
  delay?: number;
}

/**
 * Page-load stagger: each <StaggerItem> inside rises 8px and fades in, 60ms apart.
 * Runs once on mount. Under reduced motion, everything is simply there.
 */
export function Stagger({ children, className, delay = 0 }: StaggerProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : 'hidden'}
      animate="shown"
      variants={{ hidden: {}, shown: { transition: { staggerChildren: m.stagger / 1000, delayChildren: delay / 1000 } } }}
    >
      {children}
    </motion.div>
  );
}

export interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'header' | 'li';
}

export function StaggerItem({ children, className, as = 'div' }: StaggerItemProps) {
  const Comp = motion[as] as ElementType;
  return (
    <Comp
      className={className}
      variants={{
        hidden: { opacity: 0, y: 8 },
        shown: { opacity: 1, y: 0, transition: { duration: m.duration.slow / 1000, ease: motionEase.out } },
      }}
    >
      {children}
    </Comp>
  );
}
