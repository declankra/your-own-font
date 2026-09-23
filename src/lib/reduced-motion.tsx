"use client";
// Reduced motion: the system setting, or `?motion=reduce` in the URL (agent call: lets anyone,
// including our own tests, see the reduced-motion page without changing system settings).
import { MotionConfig } from "motion/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const Ctx = createContext(false);

function query(): boolean {
  if (typeof window === "undefined") return false;
  const forced = new URLSearchParams(window.location.search).get("motion");
  if (forced === "reduce") return true;
  if (forced === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const update = () => setReduce(query());
    update();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (reduce) document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, [reduce]);
  return (
    <Ctx.Provider value={reduce}>
      <MotionConfig reducedMotion={reduce ? "always" : "never"}>{children}</MotionConfig>
    </Ctx.Provider>
  );
}

export function useReduced(): boolean {
  return useContext(Ctx);
}

/** Read the setting outside React (timelines). */
export function reducedNow(): boolean {
  return query();
}
