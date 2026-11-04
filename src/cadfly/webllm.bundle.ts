// The language-model engine (WebLLM), built as its own file, webllm.bundle.js, and loaded only when
// someone opens the assistant, so everyone else does not download it.  It puts what llm.ts needs on `WebLLM`.
import * as webllm from "@mlc-ai/web-llm";

(globalThis as unknown as { WebLLM: typeof webllm }).WebLLM = webllm;
