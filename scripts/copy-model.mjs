// The letter model ships as a static file next to the page (public/letter-model.bin), copied
// from packages/letter-model at build time so there is one source of truth for the weights.
import { copyFileSync, mkdirSync } from "node:fs";
const from = new URL("../packages/letter-model/letter-model.bin", import.meta.url);
const to = new URL("../public/letter-model.bin", import.meta.url);
mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
copyFileSync(from, to);
