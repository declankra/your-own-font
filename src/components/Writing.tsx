"use client";
// State 2: Writing (SPEC.md §5, §6). One word at a time on ruled guides. The prompt letter
// fills as the pen moves (the gap rule, no model, no latency); after every pen-up the worker
// re-solves the word with the letter model and the fills settle to match.
import { animate } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { INKS, type Ink } from "@/lib/config";
import { forgetWord, segmentWord } from "@/lib/pipeline";
import { useReduced } from "@/lib/reduced-motion";
import { PAPER } from "@/lib/springs";
import type { WrittenWord } from "@/lib/types";
import { WordSession, type Guides } from "@/lib/word-session";
import { INK_PAD, InkWordSvg } from "./InkWord";
import { Logo } from "./Logo";
import { Pad, type PadSize } from "./Pad";

interface Flight {
  index: number;
  from: { left: number; top: number; width: number };
}

let nonce = 0;

export function Writing({
  pair,
  written,
  ink,
  onInk,
  onComplete,
  onReopen,
  onDone,
  onHome,
}: {
  pair: readonly [string, string];
  written: (WrittenWord | null)[];
  ink: Ink;
  onInk: (ink: Ink) => void;
  onComplete: (index: number, word: WrittenWord) => void;
  onReopen: (index: number) => void;
  onDone: () => void;
  onHome: () => void;
}) {
  const reduce = useReduced();
  const sentences = useMemo(() => pair.map((s) => s.split(/\s+/).filter(Boolean)), [pair]);
  const words = useMemo(() => sentences.flat(), [sentences]);
  const firstOpen = (from = 0) => {
    for (let k = 0; k < words.length; k++) {
      const i = (from + k) % words.length;
      if (!written[i]) return i;
    }
    return -1;
  };

  const [active, setActive] = useState(() => firstOpen());
  const [session, setSession] = useState<WordSession | null>(null);
  const [version, setVersion] = useState(0);
  const [current, setCurrent] = useState(0);
  const [pop, setPop] = useState<{ j: number; n: number } | null>(null);
  const [completing, setCompleting] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const guides = useRef<Guides | null>(null);
  const padSize = useRef<PadSize | null>(null);
  const padEl = useRef<HTMLDivElement>(null);
  const letterEls = useRef<(HTMLButtonElement | null)[]>([]);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceArmed = useRef(false);
  const sessionRef = useRef<WordSession | null>(null);
  sessionRef.current = session;

  const count = written.filter(Boolean).length;
  const allDone = count === words.length;

  // ---- a session per word
  const open = useCallback(
    (i: number) => {
      if (sessionRef.current) forgetWord(sessionRef.current.key);
      if (doneTimer.current) clearTimeout(doneTimer.current);
      forceArmed.current = false;
      setNudge(null);
      setCompleting(false);
      setActive(i);
      setCurrent(0);
      if (i < 0 || !guides.current) {
        setSession(null);
        return;
      }
      setSession(new WordSession(words[i], guides.current, `${i}:${++nonce}`));
      setVersion((v) => v + 1);
    },
    [words],
  );

  // ---- the prompt fill, painted directly so it keeps up with the pen
  const paintFills = useCallback((settle = false) => {
    const s = sessionRef.current;
    if (!s) return;
    const fills = s.fills();
    letterEls.current.forEach((el, j) => {
      if (!el) return;
      el.style.setProperty("--f", String(fills[j] ?? 0));
      if (settle) {
        el.classList.add("settle");
        setTimeout(() => el.classList.remove("settle"), 260);
      }
    });
  }, []);

  useLayoutEffect(() => {
    paintFills();
  });

  const clearTimer = () => {
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = null;
  };

  const complete = useCallback(
    async (force = false) => {
      const s = sessionRef.current;
      if (!s || s.empty || s.live || completing) return;
      clearTimer();
      setCompleting(true);
      try {
        const { strokes, version: v } = s.solverInput();
        const r = await segmentWord(s.key, strokes, s.text, s.guides, false);
        s.applySolve(r, v, false);
      } catch {
        // the model couldn't run: keep the grouping the person saw
      }
      if (s !== sessionRef.current) return;
      if (s.stuck !== null && !force) {
        const j = s.stuck;
        const ch = s.chars[j];
        setNudge(j > 0 ? `Leave a little space before the ${ch}` : `Give the ${ch} a little more room`);
        forceArmed.current = true; // a second "Next word" keeps it as written: nothing blocks you
        setCompleting(false);
        setVersion((x) => x + 1);
        paintFills(true);
        return;
      }
      paintFills(true);
      const data = s.toWordInk();
      const pad = padEl.current?.getBoundingClientRect();
      const b = s.inkBounds();
      const k = s.guides.xHeight / 500;
      if (pad && Number.isFinite(b.x0)) {
        setFlight({
          index: active,
          from: { left: pad.left + b.x0 - INK_PAD * k, top: pad.top + s.guides.baseline - 1000 * k, width: (data.width + 2 * INK_PAD) * k },
        });
      }
      const { width, ...inkData } = data;
      onComplete(active, { text: s.text, ink: inkData, width });
      forgetWord(s.key);
      const next = (() => {
        for (let q = 1; q <= words.length; q++) {
          const i = (active + q) % words.length;
          if (i !== active && !written[i]) return i;
        }
        return -1;
      })();
      // the next word is ready at once, so a quick writer never loses a stroke; the pad is
      // clear because this word's ink is already flying into the sentence
      open(next);
    },
    [active, completing, onComplete, open, paintFills, reduce, words, written],
  );

  const maybeAutoComplete = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.live || s.empty || s.stuck !== null) return;
    const last = s.chars.length - 1;
    if (s.fill(last) >= 0.5) {
      if (!doneTimer.current) doneTimer.current = setTimeout(() => {
        doneTimer.current = null;
        complete();
      }, 650);
    } else clearTimer();
  }, [complete]);

  const solve = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.empty) return;
    const { strokes, version: v } = s.solverInput();
    segmentWord(s.key, strokes, s.text, s.guides, true).then(
      (r) => {
        if (s !== sessionRef.current) return;
        const changed = s.applySolve(r, v, true);
        if (changed === null) return;
        paintFills(changed.length > 0);
        setCurrent(s.current);
        maybeAutoComplete();
      },
      () => {},
    );
  }, [maybeAutoComplete, paintFills]);

  // ---- pad callbacks
  const onSize = useCallback(
    (size: PadSize, g: Guides) => {
      const prev = guides.current;
      guides.current = g;
      padSize.current = size;
      const s = sessionRef.current;
      if (!s) {
        if (active >= 0) open(active);
        return;
      }
      if (prev && (prev.baseline !== g.baseline || prev.xHeight !== g.xHeight)) {
        // rotating or resizing clears only the word in progress
        s.guides = g;
        s.clear();
        clearTimer();
        setNudge(null);
        setCurrent(0);
        setVersion((v) => v + 1);
      }
    },
    [active, open],
  );
  const onPenDown = useCallback((popped: number | null) => {
    clearTimer();
    forceArmed.current = false;
    setNudge(null);
    const s = sessionRef.current!;
    if (popped !== null) setPop({ j: popped, n: Date.now() });
    setCurrent(s.current);
    paintFills();
  }, [paintFills]);
  const onPenMove = useCallback(() => paintFills(), [paintFills]);
  const onPenUp = useCallback(() => {
    setVersion((v) => v + 1);
    paintFills();
    maybeAutoComplete();
    solve();
  }, [maybeAutoComplete, paintFills, solve]);

  // ---- tools
  const undo = () => {
    const s = sessionRef.current;
    if (!s || completing || !s.strokes.length) return;
    clearTimer();
    forceArmed.current = false;
    setNudge(null);
    s.undo();
    setCurrent(s.current);
    setVersion((v) => v + 1);
    paintFills();
    if (s.strokes.length) solve();
  };
  const redoLetter = (j: number) => {
    const s = sessionRef.current;
    if (!s || completing) return;
    clearTimer();
    forceArmed.current = false;
    setNudge(null);
    s.redoLetter(j);
    setCurrent(j);
    setVersion((v) => v + 1);
    paintFills();
  };
  const next = () => {
    const s = sessionRef.current;
    if (!s || s.empty || completing) return;
    complete(forceArmed.current);
  };
  const reopen = (i: number) => {
    if (completing) return;
    onReopen(i);
    open(i);
  };

  // Enter completes the word (when nothing else has focus)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || document.activeElement !== document.body) return;
      next();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => () => clearTimer(), []);

  // ---- the flight: the finished word springs from the pad into its place in the sentence
  const wordRefs = useRef<(SVGSVGElement | null)[]>([]);
  useLayoutEffect(() => {
    if (!flight) return;
    const el = wordRefs.current[flight.index];
    setFlight(null);
    if (!el) return;
    const last = el.getBoundingClientRect();
    if (!last.width) return;
    if (reduce) {
      animate(el, { opacity: [0, 1] }, { duration: 0.2 });
      return;
    }
    const s = flight.from.width / last.width;
    el.style.transformOrigin = "0 0";
    animate(el, { x: [flight.from.left - last.left, 0], y: [flight.from.top - last.top, 0], scale: [s, 1] }, PAPER);
  }, [flight, reduce]);

  const text = active >= 0 ? words[active] : "";
  const chars = [...text];
  const stuck = session?.stuck ?? null;
  let wi = 0;

  return (
    <>
      <div className="topbar">
        <Logo onHome={onHome} />
        <div className="wbar">
          <div className="inkmini" role="group" aria-label="Ink">
            {INKS.map((k) => (
              <button key={k.id} style={{ ["--c" as string]: k.hex }} aria-label={k.name} aria-pressed={k.id === ink.id} onClick={() => onInk(k)} />
            ))}
          </div>
          <span className="count mono" aria-live="polite" aria-label={`${count} of ${words.length} words written`}>
            {count} / {words.length}
          </span>
          <button className={`btn primary sm${allDone ? " ready" : ""}`} disabled={!allDone} onClick={onDone}>
            Done
          </button>
        </div>
      </div>

      <div className="sentences" aria-label="Your two sentences">
        {sentences.map((ws, si) => (
          <p className="sent" key={si}>
            {ws.map((t) => {
              const i = wi++;
              const w = written[i];
              if (w)
                return (
                  <button key={i} className="w written" aria-label={`Rewrite “${t}”`} onClick={() => reopen(i)}>
                    <InkWordSvg ref={(el) => void (wordRefs.current[i] = el)} strokes={w.ink.strokes} width={w.width} />
                  </button>
                );
              return (
                <span key={i} className={`w${i === active && !allDone ? " now" : ""}`}>
                  {t}
                </span>
              );
            })}
          </p>
        ))}
      </div>

      <div className="prompt-row" style={{ visibility: allDone ? "hidden" : undefined }}>
        <div className="prompt" role="group" aria-label={`Word to write: ${text}`}>
          {chars.map((ch, j) => (
            <button
              key={`${active}:${j}`}
              ref={(el) => void (letterEls.current[j] = el)}
              className={`pl${j === current && !completing ? " now" : ""}${pop && pop.j === j ? " pop" : ""}${stuck === j ? " stuck" : ""}`}
              aria-label={`Redo ${ch}`}
              onClick={() => redoLetter(j)}
              onAnimationEnd={() => setPop(null)}
            >
              {ch}
              <span className="pf" aria-hidden="true">
                {ch}
              </span>
            </button>
          ))}
        </div>
        <div className="tools">
          <button className="btn soft sm icon" aria-label="Undo last stroke" onClick={undo}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
          </button>
          <button className="btn soft sm" onClick={next}>
            Next word
          </button>
        </div>
      </div>

      <div ref={padEl}>
        <Pad
          session={allDone ? null : session}
          version={version}
          disabled={completing || allDone}
          ink={ink.hex}
          label={allDone ? "Writing area: both sentences are written" : `Writing area. Write “${text}” on the lines with a finger, a pen or a mouse.`}
          onSize={onSize}
          onPenDown={onPenDown}
          onPenMove={onPenMove}
          onPenUp={onPenUp}
        >
          {!allDone && nudge && (
            <span className="nudge" role="status">
              {nudge}
            </span>
          )}
          {!allDone && (
            <span className="pad-hint">
              Write “{text}” on the lines
            </span>
          )}
          {allDone && (
            <div className="alldone">
              <b>That’s both sentences.</b>
              <span>Tap Done and we’ll make your font.</span>
            </div>
          )}
        </Pad>
      </div>
      <p className="wfoot">Tap a letter above to redo it. Tap a finished word to rewrite it.</p>
    </>
  );
}

