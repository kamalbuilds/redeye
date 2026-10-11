import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans, Spectral } from "next/font/google";
import { Masthead } from "@/components/shared/masthead";
import { Colophon } from "@/components/shared/colophon";
import { REDEYE_NAME } from "@/lib/redeye";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const serif = Spectral({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-spectral", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${REDEYE_NAME}: rules that act on the US session while you sleep`, template: `%s | ${REDEYE_NAME}` },
  description: "Write a rule in plain English before bed. Redeye watches every tokenized version of the stock on BNB Chain through US after-hours and acts on the best one that can trade.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <Masthead
          name={REDEYE_NAME}
          home="/"
          descriptor="Overnight rules for tokenized US stocks"
          nav={[
            { href: "/", label: "Rule", exact: true },
            { href: "/proof", label: "Proof" },
          ]}
        />
        {children}
        <Colophon
          lines={[
            { term: "Prices", text: "Per-share prices and market status come from Binance Web3 public RWA endpoints, read when you press the button. Ondo prices computed from the stock quote are marked." },
            { term: "Tradable now", text: "A real quote request goes to the Binance Web3 Trading API for each version at your rule's size. A version that returns a route is tradable; one that returns an error says why." },
            { term: "Signing", text: "This page quotes and reads. It never holds a key that can sign; the agent executes with the Binance Agentic Wallet inside the daily limit you set." },
          ]}
        />
      </body>
    </html>
  );
}
