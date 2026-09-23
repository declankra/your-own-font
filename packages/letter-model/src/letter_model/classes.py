"""The class list. Order is part of the model contract (docs/letter-model.md §2)."""

LETTERS = "abcdefghijklmnopqrstuvwxyz"
PUNCT = ",.'!?"
NULL = "∅"
CLASSES: list[str] = list(LETTERS) + list(PUNCT) + [NULL]
NULL_ID = len(CLASSES) - 1
CLASS_ID = {c: i for i, c in enumerate(CLASSES)}
N_CLASSES = len(CLASSES)
assert N_CLASSES == 32
