"use client";
// State 1: Hero (SPEC.md §4). Picking an ink is the start button.
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { renderSVG } from "uqr";
import { INKS, REPO_URL, type Ink } from "@/lib/config";
import { NIB } from "@/lib/springs";
import { useReduced } from "@/lib/reduced-motion";
import { HouseWord } from "./HouseWord";
import { Logo } from "./Logo";

export function Hero({ onPick }: { onPick: (ink: Ink) => void }) {
  const reduce = useReduced();
  const [hover, setHover] = useState<string | null>(null);
  return (
    <>
      <div className="topbar">
        <Logo />
        <span className="mono muted">
          free ·{" "}
          <a className="src" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            open source
          </a>
        </span>
      </div>
      <div className="hero-body">
        <h1 className="headline" aria-label="Draw two sentences. Get a font for your own handwriting.">
          Draw two sentences.
          <br />
          Get a font for your own
          <br />
          <HouseWord text="handwriting" color={hover ?? undefined} reduce={reduce} />
        </h1>
        <div className="pick">
          <p className="pick-label" id="pick-label">
            Pick an ink to start
          </p>
          <div className="drops" role="group" aria-labelledby="pick-label">
            {INKS.map((ink) => (
              <motion.button
                key={ink.id}
                className="drop"
                style={{ ["--c" as string]: ink.hex }}
                onPointerEnter={() => setHover(ink.hex)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(ink.hex)}
                onBlur={() => setHover(null)}
                onClick={() => onPick(ink)}
                aria-label={`Start writing in ${ink.name}`}
                data-ink={ink.id}
                initial="rest"
                whileHover="lift"
                whileFocus="lift"
                whileTap="press"
              >
                <motion.b variants={{ rest: { scale: 1, rotate: 0 }, lift: { scale: 1.1, rotate: -6 }, press: { scale: 0.9, rotate: -6 } }} transition={NIB} />
                <span>{ink.name}</span>
              </motion.button>
            ))}
          </div>
        </div>
      </div>
      <PhoneQR />
    </>
  );
}

/** Desktop only: "nicer on your phone", made on this device (no QR service). */
function PhoneQR() {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches) return;
    setSvg(renderSVG(window.location.origin + "/", { border: 1, ecc: "M", blackColor: "#1F1E1C", whiteColor: "#FFFFFF" }));
  }, []);
  if (!svg) return null;
  return (
    <div className="phone-qr" aria-hidden="true">
      <span>
        nicer on
        <br />
        your phone
      </span>
      <span dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
