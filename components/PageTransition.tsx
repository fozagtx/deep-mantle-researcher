"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "framer-motion";

/* ─────────────────────────────────────────────────────────
 * PAGE CONTENT STORYBOARD
 *
 * Static shell (header/sidebar) stays interactive immediately.
 * Page content cascades in after mount or route navigation.
 *
 *    0ms   content shell mounted
 *   80ms   page frame fades in
 *  180ms   primary section settles upward
 *  320ms   secondary sections become eligible for delayed item motion
 * ───────────────────────────────────────────────────────── */

const TIMING = {
  frame: 80,
  primary: 180,
  secondary: 320,
} as const;

const FRAME = {
  offsetY: 8,
  spring: { type: "spring" as const, stiffness: 340, damping: 30 },
};

const ITEM = {
  offsetY: 18,
  spring: { type: "spring" as const, stiffness: 320, damping: 28 },
};

type PageTransitionContextValue = {
  stage: number;
  reducedMotion: boolean;
};

const PageTransitionContext = createContext<PageTransitionContextValue>({
  stage: 3,
  reducedMotion: false,
});

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

export default function PageTransition({
  children,
  className = "",
}: PageTransitionProps) {
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState(reducedMotion ? 3 : 0);

  useEffect(() => {
    if (reducedMotion) {
      setStage(3);
      return;
    }

    const timers = [
      window.setTimeout(() => setStage(1), TIMING.frame),
      window.setTimeout(() => setStage(2), TIMING.primary),
      window.setTimeout(() => setStage(3), TIMING.secondary),
    ];

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reducedMotion]);

  return (
    <PageTransitionContext.Provider value={{ stage, reducedMotion: Boolean(reducedMotion) }}>
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: FRAME.offsetY }}
        animate={{
          opacity: stage >= 1 ? 1 : 0,
          y: stage >= 1 ? 0 : FRAME.offsetY,
        }}
        transition={FRAME.spring}
        className={className}
      >
        {children}
      </motion.div>
    </PageTransitionContext.Provider>
  );
}

export function AnimatedItem({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const { stage, reducedMotion } = useContext(PageTransitionContext);

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: ITEM.offsetY }}
      animate={{
        opacity: stage >= 2 ? 1 : 0,
        y: stage >= 2 ? 0 : ITEM.offsetY,
      }}
      transition={{ ...ITEM.spring, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
