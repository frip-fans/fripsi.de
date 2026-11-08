/** Small per-process LRU. The database revision includes external connections. */
export class ResponseCache {
  private entries = new Map<string, { expires: number; body: Uint8Array; headers: [string, string][] }>();
  private bytes = 0;
  private revision = "";
  constructor(private limit = 8 * 1024 * 1024, private ttl = 60_000) {}
  private synchronize(revision: string) {
    if (revision !== this.revision) {
      this.entries.clear(); this.bytes = 0; this.revision = revision;
    }
  }
  get(key: string, revision: string): Response | undefined {
    this.synchronize(revision);
    const item = this.entries.get(key);
    if (!item) return;
    this.entries.delete(key);
    if (item.expires <= Date.now()) { this.bytes -= item.body.byteLength; return; }
    this.entries.set(key, item);
    return new Response(item.body.slice(), { headers: item.headers });
  }
  async put(key: string, revision: string, response: Response): Promise<Response> {
    this.synchronize(revision);
    const control = response.headers.get("cache-control") ?? "";
    const type = response.headers.get("content-type") ?? "";
    if (response.status !== 200 || response.headers.has("set-cookie") || /private|no-store/i.test(control)
      || !/text\/html|application\/json/.test(type)) return response;
    // Buffer once, without Response.clone() tee queues. Astro already disables SSR streaming.
    const body = new Uint8Array(await response.arrayBuffer());
    const headers = [...response.headers.entries()] as [string, string][];
    if (body.byteLength <= Math.min(this.limit, 512 * 1024)) {
      const previous = this.entries.get(key);
      if (previous) { this.bytes -= previous.body.byteLength; this.entries.delete(key); }
      while ((this.bytes + body.byteLength > this.limit || this.entries.size >= 256) && this.entries.size) {
        const oldest = this.entries.keys().next().value!;
        this.bytes -= this.entries.get(oldest)!.body.byteLength;
        this.entries.delete(oldest);
      }
      this.entries.set(key, { body, headers, expires: Date.now() + this.ttl });
      this.bytes += body.byteLength;
    }
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }
}
