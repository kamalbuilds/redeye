import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// ImageResponse cannot read CSS variables; these are the night and sodium tokens from globals.css in sRGB
const NIGHT = "#11141c";
const SODIUM = "#f2b04a";

/** The red eye: a sodium iris on night ink. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: NIGHT, borderRadius: 14 }}>
        <div style={{ width: 46, height: 24, borderRadius: "50%", border: `4px solid ${SODIUM}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: SODIUM }} />
        </div>
      </div>
    ),
    size,
  );
}
