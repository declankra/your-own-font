// The class list. Order is part of the model contract (docs/letter-model.md §2).
export const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export const PUNCT = ",.'!?";
export const NULL_CLASS = "∅";
export const CLASSES: readonly string[] = [...LETTERS, ...PUNCT, NULL_CLASS];
export const NULL_ID = CLASSES.length - 1;
export const N_CLASSES = CLASSES.length; // 32

export function classId(ch: string): number {
  const i = CLASSES.indexOf(ch);
  if (i < 0 || i === NULL_ID) throw new Error(`not a letter class: ${JSON.stringify(ch)}`);
  return i;
}
