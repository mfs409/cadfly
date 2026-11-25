import { GeminiError } from "../../assistant/gemini";

/**
 * What the person is told when a model could not start or answer: the failure
 * put into words they can act on.
 */

/**
 * What to tell the person when the model could not start or answer.
 *
 * @param e What went wrong.
 */
export function describeFailure(e: Error): string {
  const text = e.message || String(e);
  if (e instanceof GeminiError) {
    const sentence = text.charAt(0).toUpperCase() + text.slice(1);
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  }
  if (/device.?lost/i.test(text)) return "The graphics card stopped responding while running the model, so this browser and driver cannot run it reliably. Reload the page to try again, or use a smaller model. (" + text + ")";
  if (/grammar matcher|invalid token id/i.test(text)) return "The model's output checker failed several times in a row (a known WebLLM bug). Send the request again, or try the 4B model. (" + text + ")";
  if (/compatible GPU|adapter/i.test(text)) return "No usable graphics adapter, so WebGPU cannot run the model here. Open https://webgpureport.org to check, and see the notes in the Assistant panel (on Linux Chrome, chrome://flags: Unsafe WebGPU Support and Vulkan).";
  if (/memory|OOM|allocate/i.test(text)) return `Not enough graphics memory for this model. Try the smaller one. (${text})`;
  if (/fetch|network|offline|Failed to load/i.test(text)) return `Could not download the model. Check the connection and try again. (${text})`;
  return `Something went wrong: ${text}`;
}
