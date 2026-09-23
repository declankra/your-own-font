"use client";
// iPhone and iPad (SPEC.md §8.2): install the font here through a configuration profile, or
// save the file. The profile is made by the one server route, in memory, and not stored.
import type { BuildResult } from "@your-own-font/pipeline/font";
import { useRef, useState } from "react";
import { fontFile, FONT_FILE_NAME } from "@/lib/font-face";
import { saveBlob } from "@/lib/device";
import { Sheet } from "./Sheet";

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function IosSheet({ open, onClose, result, onLeaving }: { open: boolean; onClose: () => void; result: BuildResult; onLeaving: () => void }) {
  const [step, setStep] = useState<"choose" | "install" | "saved">("choose");
  const form = useRef<HTMLFormElement>(null);
  const close = () => {
    onClose();
    setTimeout(() => setStep("choose"), 300);
  };
  const install = () => {
    onLeaving(); // the profile download is a form post; don't ask "leave this page?"
    form.current!.submit();
    setStep("install");
  };
  return (
    <Sheet open={open} onClose={close} label="Get your font on this device">
      {step === "choose" && (
        <>
          <h3>Your font, on this {typeof navigator !== "undefined" && /iPad/.test(navigator.userAgent) ? "iPad" : "iPhone"}</h3>
          <div className="row">
            <button className="choice" onClick={install}>
              <b>Install on this iPhone</b>
              <span>Then it’s in Pages, Keynote, Numbers, Goodnotes, Notability, Word and Procreate.</span>
            </button>
            <button
              className="choice"
              onClick={() => {
                saveBlob(fontFile(result), FONT_FILE_NAME);
                setStep("saved");
              }}
            >
              <b>Save the file</b>
              <span>It goes to Files. AirDrop it to your Mac and double-click.</span>
            </button>
          </div>
        </>
      )}
      {step === "install" && (
        <>
          <h3>Six taps in Settings</h3>
          <ol>
            <li>Tap <b>Allow</b> to download the profile, then <b>Close</b>.</li>
            <li>Open <b>Settings</b> and tap <b>Profile Downloaded</b>, near the top.</li>
            <li>Tap <b>Install</b> in the corner, and enter your passcode.</li>
            <li>
              iOS labels it <span className="tag">Not Signed</span> for now. That’s expected: nothing in it runs, it only adds a font. Tap{" "}
              <b>Install</b>, then <b>Install</b> again.
            </li>
            <li>Tap <b>Done</b>.</li>
            <li>Open Pages or Keynote and pick <b>My Hand</b> from the fonts.</li>
          </ol>
          <p className="muted" style={{ marginTop: 14, fontSize: 14.5 }}>
            If Stolen Device Protection is on, iOS may ask you to be somewhere familiar before it installs.
          </p>
          <div className="row">
            <button className="btn soft sm" onClick={close}>
              Got it
            </button>
          </div>
        </>
      )}
      {step === "saved" && (
        <>
          <h3>Saved to Files</h3>
          <p className="muted" style={{ marginTop: 10 }}>
            AirDrop it to your Mac and double-click to install.
          </p>
          <div className="row">
            <button className="btn soft sm" onClick={close}>
              Got it
            </button>
          </div>
        </>
      )}
      <form ref={form} method="post" action="/api/profile" hidden>
        <input type="hidden" name="font" value={open ? toBase64(result.otf) : ""} readOnly />
        <input type="hidden" name="name" value={result.postScriptName} readOnly />
      </form>
    </Sheet>
  );
}
