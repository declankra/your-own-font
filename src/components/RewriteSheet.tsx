"use client";
// Rewrite one letter from the Done sheet (SPEC.md §8.4): the guides and that letter alone.
import type { InkStroke } from "@your-own-font/pipeline/font";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { WordSession, type Guides } from "@/lib/word-session";
import { Pad } from "./Pad";
import { Sheet } from "./Sheet";

let n = 0;

export function RewriteSheet({ char, ink, onClose, onSave }: { char: string | null; ink: string; onClose: () => void; onSave: (char: string, strokes: InkStroke[]) => void }) {
  return (
    <Sheet open={char !== null} onClose={onClose} label={char ? `Rewrite ${char}` : "Rewrite a letter"} className="rewrite">
      {char && <Body char={char} ink={ink} onClose={onClose} onSave={onSave} />}
    </Sheet>
  );
}

function Body({ char, ink, onClose, onSave }: { char: string; ink: string; onClose: () => void; onSave: (char: string, strokes: InkStroke[]) => void }) {
  const [session, setSession] = useState<WordSession | null>(null);
  const [version, setVersion] = useState(0);
  const letter = useRef<HTMLSpanElement>(null);
  const paint = useCallback(() => {
    if (session && letter.current) letter.current.style.setProperty("--f", String(session.fill(0)));
  }, [session]);
  useLayoutEffect(paint);
  const onSize = useCallback((_: unknown, g: Guides) => {
    setSession((s) => {
      if (s && s.empty) {
        s.guides = g;
        return s;
      }
      return new WordSession(char, g, `rewrite:${++n}`);
    });
    setVersion((v) => v + 1);
  }, [char]);
  const empty = !session || session.strokes.length === 0;
  return (
    <>
      <div className="prompt-row" style={{ marginTop: 0 }}>
        <div className="prompt" aria-label={`Write ${char}`}>
          <span className="pl now" ref={letter} aria-hidden="true">
            {char}
            <span className="pf">{char}</span>
          </span>
        </div>
        <div className="tools">
          <button
            className="btn soft sm icon"
            aria-label="Undo last stroke"
            onClick={() => {
              session?.undo();
              setVersion((v) => v + 1);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
          </button>
        </div>
      </div>
      <Pad
        session={session}
        version={version}
        ink={ink}
        label={`Writing area. Write ${char} on the lines.`}
        onSize={onSize}
        onPenDown={() => paint()}
        onPenMove={() => paint()}
        onPenUp={() => setVersion((v) => v + 1)}
      >
        <span className="pad-hint">Write “{char}” on the lines</span>
      </Pad>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn soft sm" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary sm"
          disabled={empty}
          onClick={() => {
            if (!session || session.empty) return;
            onSave(char, session.toWordInk().strokes);
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}
