import { connection } from "next/server";
import { Page } from "@/components/shared/page";
import { Tonight } from "@/components/night/night-strip";
import { Colophon } from "@/components/shared/colophon";
import { ReceiptStack } from "@/components/night/receipt-stack";

const serverNow = () => Date.now();

export const dynamic = "force-dynamic";

export default async function Home() {
  await connection();
  const now = serverNow();
  return (
    <>
      <Tonight initialNow={now} />
      <Page className="pt-20">
        <ReceiptStack now={now} />
      </Page>
      <Colophon
        statement="Every figure on this page names the call that read it."
        lines={[
          { term: "Prices", text: "Per-share prices and market status come from Binance Web3 public RWA endpoints, read when you press the button. Ondo prices computed from the stock quote are marked." },
          { term: "Tradable now", text: "A real quote request goes to the Binance Web3 Trading API for each version at your rule's size: USDT into the token for a buy, the token into USDT for a sell. A version that returns a route is tradable; one that returns an error says why." },
          { term: "Session hours", text: "US premarket 4:00 to 9:30 am, regular 9:30 am to 4:00 pm, after-hours 4:00 to 8:00 pm, New York time, converted with the New York daylight-saving rules." },
        ]}
      />
    </>
  );
}
