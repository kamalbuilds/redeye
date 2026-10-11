import "server-only";
import { get, list, put } from "@vercel/blob";
import type { BlobIO } from "../../../src/agent/blobstore.ts";

// A private store keeps visitors' rules out of public URLs. Set BLOB_ACCESS=public only if the store was created public.
const access = process.env.BLOB_ACCESS === "public" ? "public" : "private";

/** Vercel Blob as the agent's key-value store. Reads skip the CDN so a rule armed a second ago is the rule read back. */
export const vercelBlobIO: BlobIO = {
  async read(path) {
    const res = await get(path, { access, useCache: false });
    if (!res) return null;
    if (res.statusCode !== 200) throw new Error(`blob ${path} answered ${res.statusCode}`);
    return new Response(res.stream).text();
  },
  async write(path, body) {
    await put(path, body, { access, addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
  },
  async list(prefix) {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor });
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
};
