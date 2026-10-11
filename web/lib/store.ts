import "server-only";
import { cookies } from "next/headers";
import { blobStoreMod, fileStoreMod, type WebStore } from "./shared/src";
import { REPO_DATA_DIR } from "./shared/server-env";
import { vercelBlobIO } from "./shared/blob-io";

/** The per-visitor cookie. A UUID, httpOnly, never shown. */
export const VISITOR_COOKIE = "redeye_v";

/** On Vercel (a token is present) state lives in Blob, one folder per visitor. Elsewhere it is the agent's own files in the data directory. */
export const usesBlob = (): boolean => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export async function visitorFromCookie(): Promise<string | null> {
  const v = (await cookies()).get(VISITOR_COOKIE)?.value ?? null;
  return v && (await blobStoreMod()).isVisitorId(v) ? v : null;
}

/** The visitor's store, or null when this deployment keeps per-visitor state and the visitor has none yet. */
export async function storeFor(visitor: string | null): Promise<WebStore | null> {
  if (!usesBlob()) return (await fileStoreMod()).openStore(REPO_DATA_DIR);
  if (!visitor) return null;
  return (await blobStoreMod()).openBlobStore(vercelBlobIO, visitor);
}

/** Every store the tick must walk. */
export async function allStores(): Promise<WebStore[]> {
  if (!usesBlob()) return [(await fileStoreMod()).openStore(REPO_DATA_DIR)];
  const { listVisitors, openBlobStore } = await blobStoreMod();
  return (await listVisitors(vercelBlobIO)).map((v) => openBlobStore(vercelBlobIO, v));
}

export type { WebStore };
