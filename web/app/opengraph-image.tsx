import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Redeye: leave a rule before bed, it acts on the US session while you sleep";

// ImageResponse cannot read CSS variables; these are the globals.css tokens in sRGB
const NIGHT = "#11141c";
const NIGHT_2 = "#171b25";
const LINE = "#2c3140";
const FG = "#eef0f4";
const SODIUM = "#f2b04a";
const TEXT = "RedeyeLeave a rule before bed.It acts on the US session while you sleep.";

async function caslon(): Promise<ArrayBuffer> {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Libre+Caslon+Text&text=${encodeURIComponent(TEXT)}`)).text();
  const url = css.match(/src: url\((.+?)\)/)?.[1];
  if (!url) throw new Error("Libre Caslon Text was not in the Google Fonts response");
  return (await fetch(url)).arrayBuffer();
}

export default async function OpenGraph() {
  // the 24 hour strip from noon IST: regular session 7 pm to 1:30 am, after-hours 1:30 to 5:30 am, Redeye on watch 11 pm to 5:30 am
  const hour = 1040 / 24;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: NIGHT, padding: "72px 80px", fontFamily: "Caslon", color: FG }}>
        <div style={{ fontSize: 40, display: "flex" }}>Redeye</div>
        <div style={{ fontSize: 76, lineHeight: 1.06, marginTop: 44, display: "flex", flexDirection: "column" }}>
          <span>Leave a rule before bed.</span>
          <span style={{ color: SODIUM }}>It acts on the US session while you sleep.</span>
        </div>
        <div style={{ position: "relative", display: "flex", marginTop: "auto", height: 60, width: 1040, border: `2px solid ${LINE}`, borderRadius: 8, background: NIGHT_2 }}>
          <div style={{ position: "absolute", left: 7 * hour, width: 6.5 * hour, top: 24, bottom: 0, background: "rgba(242,176,74,0.32)" }} />
          <div style={{ position: "absolute", left: 13.5 * hour, width: 4 * hour, top: 24, bottom: 0, background: SODIUM }} />
          <div style={{ position: "absolute", left: 11 * hour, width: 6.5 * hour, top: 4, bottom: 4, border: `2px solid ${SODIUM}`, borderRadius: 6 }} />
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Caslon", data: await caslon(), style: "normal", weight: 400 }] },
  );
}
