// The pipeline Web Worker. Loaded when an ink is picked (SPEC.md §9), not before.
import { attachPipeline } from "@your-own-font/pipeline/worker";

attachPipeline(self as unknown as Parameters<typeof attachPipeline>[0]);
