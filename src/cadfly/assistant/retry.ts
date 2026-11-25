/**
 * Trying a request again when the model's sampler glitches. WebLLM's
 * grammar-constrained sampling sometimes picks a token that the grammar engine
 * then refuses (an upstream bug, mlc-ai/web-llm#807). It is random, so trying
 * again usually works. The first tries use the grammar that holds the answer to
 * the schema; if the glitch keeps coming, the last try writes without it. The
 * answer's reader tolerates a fence or text around the JSON, and a bad answer
 * gets the usual repair round.
 */

/**
 * Is this error the sampler's glitch? It is told by the two messages the
 * grammar engine gives ("Grammar matcher rejected the newly sampled token",
 * "Invalid token id N for GrammarMatcher"), so that an unrelated error is not
 * tried again.
 */
export const isSamplerGlitch = (e: unknown) => /grammar matcher rejected|invalid token id/i.test(e instanceof Error ? e.message : String(e));

/** Settings for `generateWithRetry`. */
export interface RetryOptions {
  /** How many times to try with the grammar before trying without it. Default 3. */
  constrainedTries?: number;
  signal?: AbortSignal;
  /**
   * Called before each new try, to reset the model or tell the person.
   *
   * @param attempt The number of the try that just failed, from 1.
   * @param nextIsConstrained Whether the next try uses the grammar (the last one does not).
   * @param error What went wrong.
   */
  onRetry?(attempt: number, nextIsConstrained: boolean, error: unknown): void | Promise<void>;
}

/**
 * Run `generate(constrained)`, retrying when the sampler glitches. Any other
 * error, and an abort, go straight out.
 *
 * @param generate Writes the answer; `constrained` says whether to hold it to the grammar.
 * @param options Settings for the retries.
 */
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
