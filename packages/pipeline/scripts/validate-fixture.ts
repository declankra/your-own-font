// Validate recorded sessions against packages/letter-model/fixture.schema.json (ajv) and the
// structural rules in checkWord.   tsx scripts/validate-fixture.ts <file.json|.jsonl>...
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { validateSession } from "../src/letter-model/validate.ts";
import { readSessions } from "./common.ts";

const schema = JSON.parse(readFileSync(new URL("../../letter-model/fixture.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const check = ajv.compile(schema);
let bad = 0;
for (const f of process.argv.slice(2)) {
  readSessions(f).forEach((s, i) => {
    const errs = [
      ...(check(s) ? [] : (check.errors ?? []).map((e) => `schema ${e.instancePath} ${e.message}`)),
      ...validateSession(s),
    ];
    const tag = `${f}${i ? `#${i}` : ""} (${s.writerId}, ${s.words?.length ?? 0} words)`;
    if (errs.length) {
      bad++;
      console.log(`✗ ${tag}\n  ${errs.slice(0, 20).join("\n  ")}`);
    } else console.log(`✓ ${tag}`);
  });
}
process.exit(bad ? 1 : 0);
