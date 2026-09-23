"""Where things live."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # packages/letter-model
REPO = ROOT.parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw"  # downloads, never committed
REAL = DATA / "real"  # real writers' sessions (phase 2), never committed
CACHE = DATA / "cache"  # synthesized arrays and checkpoints, never committed
REPORT = ROOT / "report"  # metrics and failure images (small, committed)
BIN = ROOT / "letter-model.bin"
PROTOTYPE = REPO / "design" / "homepage-prototype.html"
PIPELINE = REPO / "packages" / "pipeline"
PARITY = PIPELINE / "test" / "fixtures"
