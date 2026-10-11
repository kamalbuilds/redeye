import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { armRule, RuleError } from "@/lib/redeye";
import { storeFor, usesBlob, VISITOR_COOKIE, visitorFromCookie } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON like {\"text\": \"if TSLA drops 8% buy $6\"}." }, { status: 400 });
  }
  if (typeof body.text !== "string") return Response.json({ error: "text must be a string." }, { status: 400 });

  let visitor = await visitorFromCookie();
  const fresh = visitor === null;
  if (!visitor) visitor = randomUUID();
  try {
    const store = await storeFor(visitor);
    if (!store) throw new Error("no store");
    const armed = await armRule(body.text, store);
    if (usesBlob() && fresh) {
      (await cookies()).set(VISITOR_COOKIE, visitor, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    }
    return Response.json(armed, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof RuleError) return Response.json({ error: e.message }, { status: 422 });
    console.error("arm route", e);
    return Response.json({ error: "The rule could not be saved. Try again in a moment." }, { status: 502 });
  }
}
