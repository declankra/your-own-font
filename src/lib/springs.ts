// The three Motion springs (DECISIONS.md → Visual identity; design/identity.html → Motion).
// Nothing else moves the page. CSS transitions use the same springs, sampled into linear().

export const NIB = { type: "spring", stiffness: 520, damping: 32, mass: 1 } as const;
export const PAPER = { type: "spring", stiffness: 140, damping: 14, mass: 1 } as const;
export const PRESS = { type: "spring", stiffness: 260, damping: 30, mass: 3 } as const;

/** Sample a spring into a CSS linear() easing and its settle time (the identity's recipe). */
export function springCurve(k: number, c: number, m: number): { easing: string; ms: number } {
  let x = 0;
  let v = 0;
  const out = [0];
  let settle = 0;
  for (let t = 1; t < 4000; t++) {
    const a = (-k * (x - 1) - c * v) / m;
    v += a / 1000;
    x += v / 1000;
    if (t % 14 === 0) out.push(+x.toFixed(4));
    if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.02) {
      settle = t;
      break;
    }
  }
  out.push(1);
  return { easing: `linear(${out.join(",")})`, ms: settle || 4000 };
}

/** CSS custom properties for the springs, set on <html>. */
export function springVars(): Record<string, string> {
  const nib = springCurve(NIB.stiffness, NIB.damping, NIB.mass);
  const paper = springCurve(PAPER.stiffness, PAPER.damping, PAPER.mass);
  const press = springCurve(PRESS.stiffness, PRESS.damping, PRESS.mass);
  return {
    "--ease-nib": nib.easing,
    "--dur-nib": `${nib.ms}ms`,
    "--ease-paper": paper.easing,
    "--dur-paper": `${paper.ms}ms`,
    "--ease-press": press.easing,
    "--dur-press": `${press.ms}ms`,
  };
}
