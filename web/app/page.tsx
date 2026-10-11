import { connection } from "next/server";
import { Page } from "@/components/shared/page";
import { NightStrip } from "@/components/night/night-strip";
import { Desk } from "@/components/night/desk";
import { ReceiptStack } from "@/components/night/receipt-stack";

const serverNow = () => Date.now();

export const dynamic = "force-dynamic";

export default async function Home() {
  await connection();
  const now = serverNow();
  return (
    <>
      <NightStrip initialNow={now} />
      <Page className="pt-16">
        <Desk />
        <div className="mt-28">
          <ReceiptStack now={now} />
        </div>
      </Page>
    </>
  );
}
