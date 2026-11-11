export function screenFeed(
  signal: AbortSignal,
  subscribe: (receive: (index: number, frame: Buffer) => void) => () => void,
) {
  const encoder = new TextEncoder();
  const latest = new Map<number, Buffer>();
  let flush: () => void;
  let stop: () => void;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (line: string) => controller.enqueue(encoder.encode(line));
      flush = () => {
        for (const [index, frame] of latest) {
          if ((controller.desiredSize ?? 0) <= 0) return;
          latest.delete(index);
          send(`data: ${JSON.stringify([index, frame.toString("base64")])}\n\n`);
        }
      };
      send("retry: 750\n\n");
      const unsubscribe = subscribe((index, frame) => {
        latest.set(index, frame);
        flush();
      });
      const heartbeat = setInterval(() => {
        if ((controller.desiredSize ?? 0) > 0) send(": heartbeat\n\n");
      }, 15_000);
      const close = () => {
        stop();
        controller.close();
      };
      stop = () => {
        signal.removeEventListener("abort", close);
        clearInterval(heartbeat);
        unsubscribe();
        latest.clear();
      };
      if (signal.aborted) close();
      else signal.addEventListener("abort", close, { once: true });
    },
    pull: () => flush(),
    cancel: () => stop(),
  });
}
