"use client";
// The one page: hero | writing | making | done (SPEC.md §3). Strokes live in memory only;
// reloading returns to Hero. Nothing about the session leaves the device.
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INKS, type Ink } from "@/lib/config";
import { startPipeline } from "@/lib/pipeline";
import { ReducedMotionProvider, useReduced } from "@/lib/reduced-motion";
import { POOL } from "@/lib/sentences";
import { PAPER } from "@/lib/springs";
import type { Phase, WrittenWord } from "@/lib/types";
import { Foundry } from "./Foundry";
import { Hero } from "./Hero";
import { Writing } from "./Writing";

export function App() {
  return (
    <ReducedMotionProvider>
      <Page />
    </ReducedMotionProvider>
  );
}

function Page() {
  const reduce = useReduced();
  const [phase, setPhase] = useState<Phase>("hero");
  const [ink, setInkState] = useState<Ink>(INKS[0]);
  const [pairIndex, setPairIndex] = useState(0);
  const pair = POOL[pairIndex];
  const wordCount = useMemo(() => pair.join(" ").split(/\s+/).length, [pair]);
  const [written, setWritten] = useState<(WrittenWord | null)[]>(() => Array(wordCount).fill(null));
  const [runs, setRuns] = useState(0);
  const [toast, setToast] = useState<{ msg: string; n: number } | null>(null);
  const leaving = useRef(false);
  const [debug, setDebug] = useState<{ fail: boolean }>({ fail: false });

  // one pair at random per visit (after hydration, so server and client agree)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const forced = Number(q.get("pair"));
    const idx = Number.isInteger(forced) && forced >= 1 && forced <= POOL.length ? forced - 1 : Math.floor(Math.random() * POOL.length);
    setPairIndex(idx);
    setWritten(Array(POOL[idx].join(" ").split(/\s+/).length).fill(null));
    setDebug({ fail: q.get("fail") === "build" });
  }, []);

  const setInk = useCallback((k: Ink) => {
    setInkState(k);
    document.documentElement.style.setProperty("--ink", k.hex);
    document.documentElement.style.setProperty("--on-ink", k.id === "graphite" ? "#FFFEFB" : "#FFFFFF");
  }, []);

  // once there is ink, leaving the page asks first (agent call)
  const hasInk = phase !== "hero";
  useEffect(() => {
    if (!hasInk) return;
    const h = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [hasInk]);

  const go = (p: Phase) => {
    setPhase(p);
    window.scrollTo(0, 0);
  };

  const onToast = useCallback((msg: string) => setToast({ msg, n: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const screen = phase === "making" || phase === "done" ? "foundry" : phase;
  const allWords = written.every(Boolean);

  return (
    <div className="app">
      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={screen}
          className="screen"
          aria-label={screen === "hero" ? "Start" : screen === "writing" ? "Writing" : "Your font"}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0, transition: reduce ? { duration: 0.2 } : { ...PAPER, opacity: { duration: 0.3 } } }}
          exit={reduce ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, y: -14, transition: { duration: 0.3 } }}
        >
          <div className="inner">
            {screen === "hero" && (
              <Hero
                onPick={(k) => {
                  setInk(k);
                  startPipeline().catch(() => {}); // the worker and model load now, not before
                  go("writing");
                }}
              />
            )}
            {screen === "writing" && (
              <Writing
                pair={pair}
                written={written}
                ink={ink}
                onInk={setInk}
                onComplete={(i, w) => setWritten((ws) => ws.map((x, k) => (k === i ? w : x)))}
                onReopen={(i) => setWritten((ws) => ws.map((x, k) => (k === i ? null : x)))}
                onDone={() => {
                  if (!allWords) return;
                  setRuns((r) => r + 1);
                  go("making");
                }}
              />
            )}
            {screen === "foundry" && (
              <Foundry
                words={written.filter((w): w is WrittenWord => !!w).map((w) => w.ink)}
                ink={ink}
                runs={runs}
                failNext={debug.fail}
                onPhase={(p) => setPhase(p)}
                onToast={onToast}
                onLeaving={() => {
                  leaving.current = true;
                  setTimeout(() => (leaving.current = false), 2000);
                }}
              />
            )}
          </div>
        </motion.section>
      </AnimatePresence>
      <div className={`toast${toast ? " on" : ""}`} role="status" aria-live="polite">
        {toast?.msg}
      </div>
    </div>
  );
}
