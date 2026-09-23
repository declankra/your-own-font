"use client";
// States 3 and 4: Making (SPEC.md §7) and Done (§8). One sheet: the letters are cast, set,
// inked and pressed on it, then the note writes itself underneath and the two actions arrive.
import type { BuildResult, BuiltGlyph, InkStroke, WordInk } from "@your-own-font/pipeline/font";
import { animate, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BuildGate } from "@/lib/build-gate";
import { SHARE_TEXT, type Ink } from "@/lib/config";
import { isAndroid, isIOS, saveBlob } from "@/lib/device";
import { FONT_FILE_NAME, fontFile, loadBuiltFont } from "@/lib/font-face";
import { Cancelled, MIN_MS, runMaking, type MakingUI } from "@/lib/making";
import { buildInWorker } from "@/lib/pipeline";
import { useReduced } from "@/lib/reduced-motion";
import { PAPER, PRESS } from "@/lib/springs";
import { GlyphArt } from "./GlyphArt";
import { IosSheet } from "./IosSheet";
import { Logo } from "./Logo";
import { Note } from "./Note";
import { RewriteSheet } from "./RewriteSheet";

const ABC = "abcdefghijklmnopqrstuvwxyz";

interface Slots {
  lifted: boolean[];
  cast: boolean[];
  inked: boolean[];
  printed: boolean;
  snap: boolean;
  fade: boolean;
}
const fresh = (): Slots => ({ lifted: Array(26).fill(false), cast: Array(26).fill(false), inked: Array(26).fill(false), printed: false, snap: false, fade: false });

export function Foundry({
  words,
  ink,
  runs,
  failNext,
  onPhase,
  onToast,
  onLeaving,
}: {
  words: WordInk[];
  ink: Ink;
  /** how many times Making has run this session (1 on the first run) */
  runs: number;
  /** tests: make the worker throw during the build */
  failNext?: boolean;
  onPhase: (p: "making" | "done") => void;
  onToast: (msg: string) => void;
  onLeaving: () => void;
}) {
  const reduce = useReduced();
  const [phase, setPhase] = useState<"making" | "error" | "done">("making");
  const [caption, setCaption] = useState("casting letters");
  const [glyphs, setGlyphs] = useState<(BuiltGlyph | null)[]>(Array(26).fill(null));
  const [slots, setSlots] = useState<Slots>(fresh);
  const [setRow, setSetRow] = useState(false);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [noteDone, setNoteDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [skipping, setSkipping] = useState(false);
  const [thunk, setThunk] = useState<string | null>(null);
  const [rewrite, setRewrite] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, InkStroke[]>>({});
  const [iosOpen, setIosOpen] = useState(false);
  const [flying, setFlying] = useState(0);
  const abcRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const rollerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef(false);
  skipRef.current = skipping;

  // ---- one run of the pipeline + the timeline that waits on it
  useEffect(() => {
    let alive = true;
    const gate = new BuildGate();
    setPhase("making");
    setCaption("casting letters");
    setGlyphs(Array(26).fill(null));
    setSlots(fresh());
    setSetRow(false);
    setResult(null);
    setNoteDone(false);
    onPhase("making");
    const mark = (k: "lifted" | "cast" | "inked", i: number, v = true) =>
      setSlots((s) => {
        const arr = s[k].slice();
        arr[i] = v;
        return { ...s, [k]: arr };
      });
    const ui: MakingUI = {
      caption: (t) => setCaption(t),
      lift: (i) => {
        setGlyphs((g) => {
          const n = g.slice();
          n[i] = gate.glyphs[i];
          return n;
        });
        mark("lifted", i);
      },
      cast: (i) => mark("cast", i),
      setRow: () => setSetRow(true),
      fadeIn: (i) => {
        setSlots((s) => ({ ...s, fade: true }));
        ui.lift(i);
      },
      roll: () =>
        new Promise<void>((resolve) => {
          const abc = abcRef.current;
          const roller = rollerRef.current;
          if (!abc || !roller) return resolve();
          const slotsEl = Array.from(abc.children) as HTMLElement[];
          const aw = abc.offsetWidth;
          roller.style.opacity = "1";
          const T = 950;
          const t0 = performance.now();
          const inked = new Set<number>();
          // rows are swept together, left to right, like one long roller
          const f = (now: number) => {
            if (!alive) return resolve();
            const p = Math.min(1, (now - t0) / T);
            const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            const x = -30 + e * (aw + 60);
            roller.style.transform = `translateX(${x}px)`;
            slotsEl.forEach((s, i) => {
              if (!inked.has(i) && s.offsetLeft + s.offsetWidth / 2 < x) {
                inked.add(i);
                mark("inked", i);
              }
            });
            if (p < 1) requestAnimationFrame(f);
            else {
              roller.style.transition = "opacity .3s";
              roller.style.opacity = "0";
              for (let i = 0; i < 26; i++) if (!inked.has(i)) mark("inked", i);
              resolve();
            }
          };
          requestAnimationFrame(f);
        }),
      press: async () => {
        const head = headRef.current;
        const abc = abcRef.current;
        if (!head || !abc) return;
        const lift = -(abc.offsetHeight + 200);
        head.style.opacity = "1";
        head.style.transform = `translateY(${lift}px)`;
        await new Promise((r) => setTimeout(r, 200));
        await animate(head, { y: [lift, 0] }, PRESS);
        const area = areaRef.current;
        if (area) {
          area.classList.remove("shake");
          void area.offsetWidth;
          area.classList.add("shake");
        }
        // the sorts flip back as printed paper glyphs
        setSlots((s) => ({ ...s, printed: true, snap: true, cast: Array(26).fill(false) }));
        await new Promise((r) => setTimeout(r, 180));
        setSlots((s) => ({ ...s, snap: false }));
        await animate(head, { y: [0, lift], opacity: [1, 0] }, { ...PAPER, stiffness: 140, damping: 18, mass: 1.4 });
      },
    };

    const input = { words, overrides };
    buildInWorker(input, (e) => gate.push(e), { fail: failNext && attempt === 0 }).then(
      async (r) => {
        const fam = await loadBuiltFont(r);
        if (!alive) return;
        setFamily(fam);
      },
      (err) => gate.fail(err instanceof Error ? err : new Error(String(err))),
    );
    runMaking(gate, ui, { reduced: reduce, minMs: runs <= 1 && attempt === 0 ? MIN_MS : 0, alive: () => alive, skipping: () => skipRef.current })
      .then(() => {
        if (!alive) return;
        setResult(gate.result);
        setSlots((s) => ({ ...s, lifted: Array(26).fill(true), printed: true, cast: Array(26).fill(false) }));
        setPhase("done");
        setCaption("");
        onPhase("done");
      })
      .catch((err) => {
        if (!alive || err instanceof Cancelled) return;
        console.error("the font build failed", err);
        setPhase("error");
      });
    return () => {
      alive = false;
    };
    // a run is keyed by `attempt`; everything else is read at its start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // ---- Done: rewrite one letter, rebuild without the press
  const saveRewrite = useCallback(
    (ch: string, strokes: InkStroke[]) => {
      setRewrite(null);
      const next = { ...overrides, [ch]: strokes };
      setOverrides(next);
      buildInWorker({ words, overrides: next }, () => {}).then(
        async (r) => {
          const fam = await loadBuiltFont(r);
          setResult(r);
          setFamily(fam);
          const glyph = r.glyphs.find((g) => g.char === ch && g.variant === 0) ?? null;
          setGlyphs((g) => g.map((x, i) => (ABC[i] === ch ? glyph : x)));
          setThunk(ch);
          setTimeout(() => setThunk(null), 500);
        },
        () => onToast("That letter didn’t take. Try it once more."),
      );
    },
    [overrides, words, onToast],
  );

  const download = () => {
    if (!result) return;
    if (isIOS()) return setIosOpen(true);
    saveBlob(fontFile(result), FONT_FILE_NAME);
    if (!isAndroid()) onToast("Double-click it to install.");
  };
  const share = async () => {
    setFlying((f) => f + 1);
    const url = window.location.origin + "/";
    const data = { title: "your own font", text: SHARE_TEXT, url };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
        await navigator.share(data);
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      onToast("Link copied");
    } catch {
      onToast(url);
    }
  };

  const done = phase === "done";
  const aGlyph = result?.glyphs.find((g) => g.char === "a" && g.variant === 0) ?? null;
  const heading = phase === "error" ? "That didn’t work" : done ? "Here’s your font." : "Making your font";
  const sub = phase === "error" ? "Your writing is still here." : caption;

  return (
    <>
      <div className="topbar">
        <Logo own={done ? aGlyph?.strokes : null} />
        <span />
      </div>
      <div style={{ display: "contents" }}>
        <div className="phead">
          <h2 aria-live="polite">{heading}</h2>
          <p className="mono" aria-live="off">
            {sub}
          </p>
        </div>
        {phase === "error" && (
          <div className="try-again">
            <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
          </div>
        )}
        <div className={`sheetwrap${done ? " done" : ""}`} hidden={phase === "error" && !glyphs.some(Boolean)}>
          <div className="sheet-bg" />
          {phase === "making" && (runs > 1 || attempt > 0) && !skipping && (
            <button className="btn soft sm skip" onClick={() => setSkipping(true)}>
              Skip
            </button>
          )}
          <div className={`press-area`} ref={areaRef}>
            <div className="abcwrap">
              <div className={`abc${setRow && !done ? " set" : ""}`} ref={abcRef} role={done ? "group" : undefined} aria-label={done ? "Your alphabet. Tap a letter to rewrite it." : undefined}>
                {[...ABC].map((ch, i) => {
                  const g = glyphs[i];
                  const cls = [
                    "slot",
                    slots.lifted[i] && "lifted",
                    slots.inked[i] && "inked",
                    slots.printed && "printed",
                    slots.fade && "fade",
                    thunk === ch && "thunk",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const card = (
                    <div className={`card${slots.cast[i] ? " cast" : ""}${slots.snap ? " snap" : ""}`}>
                      <div className="face front">
                        <span className="ph">{ch}</span>
                        {g && <GlyphArt className="glyph" glyph={g} family={slots.printed ? family : null} />}
                      </div>
                      <div className="face back">{g && <GlyphArt glyph={g} />}</div>
                    </div>
                  );
                  return done ? (
                    <button key={ch} className={cls} aria-label={`Rewrite ${ch}`} onClick={() => setRewrite(ch)}>
                      {card}
                    </button>
                  ) : (
                    <div key={ch} className={cls} aria-hidden="true">
                      {card}
                    </div>
                  );
                })}
              </div>
              {!reduce && phase !== "done" && <div className="roller" ref={rollerRef} style={{ opacity: 0 }} />}
              {!reduce && phase !== "done" && (
                <div className="presshead" ref={headRef} style={{ opacity: 0 }}>
                  <div className="bar" />
                </div>
              )}
            </div>
          </div>
          {done && result && <Note result={result} animate={!reduce} onWritten={() => setNoteDone(true)} />}
        </div>
        {done && result && (
          <motion.div
            className="actions"
            initial={{ opacity: 0, y: 14 }}
            animate={noteDone ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
            transition={PAPER}
            style={{ pointerEvents: noteDone ? "auto" : "none" }}
          >
            <button className="obj" aria-label="Download your font" onClick={download}>
              <span className="thing file">
                <span className="fglyph">{aGlyph && <GlyphArt glyph={aGlyph} family={family} />}</span>
                <span className="fext">.otf</span>
                <span className="badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v12M6.5 11.5 12 17l5.5-5.5" />
                  </svg>
                </span>
              </span>
              <span className="cap">Download</span>
            </button>
            <button className="obj" aria-label="Share this page with a friend" onClick={share}>
              <span className={`thing plane${flying ? " fly" : ""}`} key={flying} aria-hidden="true">
                <svg viewBox="0 0 88 88">
                  <path className="trail" d="M8 76 C 16 72, 22 66, 30 60" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="1 6" />
                  <g className="craft">
                    <polygon points="14,44 78,16 40,52" fill="#FFFFFF" stroke="#D9D4CC" strokeWidth="1.2" strokeLinejoin="round" />
                    <polygon points="40,52 78,16 52,74" fill="#F1EEE8" stroke="#D9D4CC" strokeWidth="1.2" strokeLinejoin="round" />
                    <polygon points="40,52 52,74 44,60" fill="#E1DCD3" stroke="#D9D4CC" strokeWidth="1" strokeLinejoin="round" />
                  </g>
                </svg>
              </span>
              <span className="cap">Share</span>
            </button>
          </motion.div>
        )}
      </div>
      {result && <IosSheet open={iosOpen} onClose={() => setIosOpen(false)} result={result} onLeaving={onLeaving} />}
      <RewriteSheet char={rewrite} ink={ink.hex} onClose={() => setRewrite(null)} onSave={saveRewrite} />
    </>
  );
}

