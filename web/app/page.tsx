import { Page } from "@/components/shared/page";
import { RuleDesk } from "@/components/redeye/rule-desk";
import { Receipts } from "@/components/redeye/receipts";
import { REDEYE_LINE } from "@/lib/redeye";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <Page>
      <h1 className="max-w-[12ch] text-[2.5rem] font-light leading-[1.05] tracking-[-0.015em] md:max-w-[18ch] md:text-[3.5rem]">{REDEYE_LINE}</h1>
      <p className="mt-5 max-w-[56ch] text-[1.0625rem] text-ink-2">
        US companies report at 4 pm in New York, which is 1:30 am in Mumbai. Write the rule before bed. Redeye shows how it read you and which tokenized version of the stock can actually trade.
      </p>
      <div className="mt-10">
        <RuleDesk />
      </div>
      <Receipts />
    </Page>
  );
}
