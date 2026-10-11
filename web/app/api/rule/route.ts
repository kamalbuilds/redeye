import { inspectRule, RuleError } from "@/lib/redeye";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { text?: unknown; wallet?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON like {\"text\": \"if TSLA drops 8% buy $6\"}." }, { status: 400 });
  }
  if (typeof body.text !== "string") return Response.json({ error: "text must be a string." }, { status: 400 });
  try {
    return Response.json(await inspectRule(body.text, typeof body.wallet === "string" ? body.wallet : undefined));
  } catch (e) {
    if (e instanceof RuleError) return Response.json({ error: e.message }, { status: 422 });
    console.error("rule route", e);
    return Response.json({ error: "Live data failed while reading the market. Try again in a moment." }, { status: 502 });
  }
}
