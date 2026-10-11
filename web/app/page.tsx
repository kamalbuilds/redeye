import { Page } from "@/components/shared/page";
import { NightStrip } from "@/components/night/night-strip";
import { Desk } from "@/components/night/desk";
import { ReceiptStack } from "@/components/night/receipt-stack";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <NightStrip initialNow={Date.now()} />
      <Page className="pt-16">
        <Desk />
        <div className="mt-28">
          <ReceiptStack />
        </div>
      </Page>
    </>
  );
}
