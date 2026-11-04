/**
 * WebLLM's grammar-constrained sampling sometimes picks a token the grammar engine then refuses
 * ("Grammar matcher rejected the newly sampled token"; an upstream bug, mlc-ai/web-llm#807). It is random,
 * so trying again usually works. After a few tries, write without the grammar: the reply reader
 * tolerates a fence or text around the JSON, and a bad reply gets the usual repair round.
 */
export const isSamplerGlitch = (e: unknown) => /grammar matcher rejected|invalid token id|out of range/i.test(e instanceof Error ? e.message : String(e));

export interface RetryOptions {
  /** How many times to try with the grammar before trying without it. Default 3. */
  constrainedTries?: number;
  signal?: AbortSignal;
  /** Called before each new try, to reset the model or tell the person */
  onRetry?(attempt: number, constrained: boolean, error: unknown): void | Promise<void>;
}

/** Run `generate(constrained)`, retrying when the sampler glitches. Any other error, and an abort, go straight out. */
export async function generateWithRetry(generate: (constrained: boolean) => Promise<string>, options: RetryOptions = {}): Promise<string> {
  const tries = Math.max(1, options.constrainedTries ?? 3);
  let last: unknown;
  for (let attempt = 1; attempt <= tries + 1; attempt++) {
    const constrained = attempt <= tries;
    try {
      return await generate(constrained);
    } catch (e) {
      if (options.signal?.aborted || !isSamplerGlitch(e)) throw e;
      last = e;
      if (attempt <= tries) await options.onRetry?.(attempt, attempt < tries, e);
    }
  }
  throw last;
}
