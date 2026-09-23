# your own font

Draw two sentences. Get a font for your own handwriting.

Everything happens in your browser: you write on the page, an on-device letter model sorts
your strokes into letters, and a Web Worker builds a real `.otf` from your ink. No account,
no storage, nothing uploaded. The one server route wraps the font in an iOS install profile,
in memory, when you ask it to.

```bash
npm install
npm run dev
```

MIT licensed. Product decisions: `DECISIONS.md`. The page spec: `SPEC.md`.
