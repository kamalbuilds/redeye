import { readMarketStatus } from "@/lib/redeye";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await readMarketStatus(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("status route", e);
    return Response.json({ error: "Binance market status is unreachable right now." }, { status: 502 });
  }
}
