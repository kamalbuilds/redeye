import type { Metadata } from "next";
import { Azeret_Mono, Geist, Libre_Caslon_Text } from "next/font/google";
import { Masthead } from "@/components/shared/masthead";
import { Colophon } from "@/components/shared/colophon";
import { REDEYE_NAME } from "@/lib/redeye";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const serif = Libre_Caslon_Text({ subsets: ["latin"], weight: ["400"], style: "normal", variable: "--font-display", display: "swap" });
const mono = Azeret_Mono({ subsets: ["latin"], variable: "--font-azeret-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${REDEYE_NAME}: rules that act on the US session while you sleep`, template: `%s | ${REDEYE_NAME}` },
  description: "Leave a rule before bed. Redeye watches every tokenized version of the stock on BNB Chain through US after-hours and acts on the best one that can trade.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <Masthead
          name={REDEYE_NAME}
          home="/"
          nav={[
            { href: "/", label: "Tonight", exact: true },
            { href: "/proof", label: "Replay" },
          ]}
        />
        {children}
        <Colophon
          statement="Every figure on this page names the call that read it."
          lines={[
            { term: "Prices", text: "Per-share prices and market status come from Binance Web3 public RWA endpoints, read when you press the button. Ondo prices computed from the stock quote are marked." },
            { term: "Tradable now", text: "A real quote request goes to the Binance Web3 Trading API for each version at your rule's size. A version that returns a route is tradable; one that returns an error says why." },
            { term: "Session hours", text: "US premarket 4:00 to 9:30 am, regular 9:30 am to 4:00 pm, after-hours 4:00 to 8:00 pm, New York time, converted with the New York daylight-saving rules." },
          ]}
        />
      </body>
    </html>
  );
}
