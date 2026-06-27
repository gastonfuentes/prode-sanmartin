/**
 * SwipeNavigator — mobile swipe between rounds.
 *
 * Wraps the round's fixtures column. On touch devices the content follows the
 * finger horizontally (rubber-band, snaps back), and releasing past a threshold
 * navigates to the previous/next round. With loading.tsx in place that
 * navigation lands on an instant skeleton, so the swipe feels fluid.
 *
 * Only active on small, coarse-pointer screens — on desktop the children render
 * plainly so the md: two-column grid is never touched by drag. A subtle mount
 * transition plays on every round change (the component remounts per route).
 *
 * Vertical scrolling is preserved via touchAction: "pan-y" + dragDirectionLock:
 * the browser keeps vertical pan, framer-motion only claims horizontal drag.
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, type PanInfo } from "framer-motion";

interface SwipeNavigatorProps {
  prevRoundId: number | null;
  nextRoundId: number | null;
  children: React.ReactNode;
}

// Horizontal distance (px) past which a release commits to navigation.
const SWIPE_THRESHOLD = 80;

export function SwipeNavigator({
  prevRoundId,
  nextRoundId,
  children,
}: SwipeNavigatorProps) {
  const router = useRouter();
  const x = useMotionValue(0);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px) and (pointer: coarse)");
    const update = () => setIsTouch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Prefetch neighbours so a committed swipe resolves quickly.
  useEffect(() => {
    if (!isTouch) return;
    if (prevRoundId != null) router.prefetch(`/rounds/${prevRoundId}`);
    if (nextRoundId != null) router.prefetch(`/rounds/${nextRoundId}`);
  }, [isTouch, prevRoundId, nextRoundId, router]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    // Swipe left (negative) → forward / next round. Swipe right → previous.
    if (info.offset.x <= -SWIPE_THRESHOLD && nextRoundId != null) {
      router.push(`/rounds/${nextRoundId}`);
    } else if (info.offset.x >= SWIPE_THRESHOLD && prevRoundId != null) {
      router.push(`/rounds/${prevRoundId}`);
    }
    // Otherwise the rubber-band (constraints 0/0) snaps content back in place.
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <motion.div
        style={{ x, touchAction: "pan-y" }}
        drag={isTouch ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.3}
        onDragEnd={handleDragEnd}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
