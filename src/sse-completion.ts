/** Internal framing observations only; the SDK still parses and validates JSON. */
export class SseCompletionObserver {
  done = false;
  truncated = false;
  private readonly decoder = new TextDecoder();
  // Only the longest possible terminal line, "data: [DONE]", is retained.
  private line = '';
  private longLine = false;
  private afterCR = false;
  private pendingEvent = false;
  private dataLines = 0;
  private terminalData = false;

  observe(bytes: Uint8Array): void {
    this.scan(this.decoder.decode(bytes, { stream: true }));
  }

  end(): void {
    this.scan(this.decoder.decode());
    this.truncated = !this.done && (this.pendingEvent || (this.line.length > 0 && !this.line.startsWith(':')));
  }

  private scan(text: string): void {
    for (const char of text) {
      // The SDK cancels at its first complete [DONE] event. Do not interpret
      // bytes beyond that application boundary as another unfinished event.
      if (this.done) return;
      if (this.afterCR) {
        this.afterCR = false;
        if (char === '\n') continue;
      }
      if (char === '\r' || char === '\n') {
        this.endLine();
        this.afterCR = char === '\r';
      } else if (this.line.length < 12) this.line += char;
      else this.longLine = true;
    }
  }

  private endLine(): void {
    if (this.line.length === 0) {
      if (this.dataLines === 1 && this.terminalData) this.done = true;
      this.pendingEvent = false;
      this.dataLines = 0;
      this.terminalData = false;
    } else if (!this.line.startsWith(':')) {
      this.pendingEvent = true;
      if (this.line === 'data' || this.line.startsWith('data:')) {
        this.terminalData = this.dataLines === 0 && !this.longLine
          && (this.line === 'data:[DONE]' || this.line === 'data: [DONE]');
        this.dataLines = Math.min(2, this.dataLines + 1);
      }
    }
    this.line = '';
    this.longLine = false;
  }
}

/** Pull-based forwarding avoids a tee, body copies, and an unbounded side queue. */
export function observeSseCompletion(response: Response, completion: SseCompletionObserver): Response {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) return response;
  const upstream = response.body.getReader();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await upstream.read();
        if (cancelled) return;
        if (chunk.done) {
          completion.end();
          upstream.releaseLock();
          controller.close();
        } else {
          completion.observe(chunk.value);
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        if (!cancelled) {
          upstream.releaseLock();
          controller.error(error);
        }
      }
    },
    async cancel(reason) {
      cancelled = true;
      try { await upstream.cancel(reason); }
      finally { upstream.releaseLock(); }
    },
  }, { highWaterMark: 0 });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
