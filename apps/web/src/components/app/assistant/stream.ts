import type { AssistantStreamEvent } from "@fieldops/shared";

/**
 * Reads the server-sent events of `POST /api/v1/ai/assistant` from a fetch response (EventSource can't POST).
 * Yields each event's JSON; lines it doesn't understand are skipped.
 */
export async function* readAssistantEvents(res: Response): AsyncGenerator<AssistantStreamEvent> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          yield JSON.parse(data) as AssistantStreamEvent;
        } catch {
          // not an event of ours
        }
      }
      end = buffer.indexOf("\n\n");
    }
  }
}
