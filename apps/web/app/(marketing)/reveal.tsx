'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * One reveal primitive for the whole page, rather than a `whileInView` spelled out per section.
 *
 * `once` matters: a section that re-animates every time it crosses the viewport reads as a bug on
 * the way back up the page. Under reduced motion this renders a plain element with no transform,
 * so nothing moves and nothing has to be undone by a media query.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  const still = useReducedMotion();
  const Tag = motion[as];

  if (still) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -5% 0px', amount: 0.15 }}
      transition={{ duration: 0.9, delay, ease: [0.22, 0.8, 0.24, 1] }}
    >
      {children}
    </Tag>
  );
}
