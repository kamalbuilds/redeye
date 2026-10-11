import type { Metadata } from "next";
import { Azeret_Mono, Geist, Libre_Caslon_Text } from "next/font/google";
import { Masthead } from "@/components/shared/masthead";
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
      </body>
    </html>
  );
}
