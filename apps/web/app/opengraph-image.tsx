import { ImageResponse } from "next/og";

/**
 * Social preview card.
 *
 * The metadata previously pointed at /brand/og-default.png, which was never
 * created — so every link shared to WhatsApp, Slack, LinkedIn or X rendered
 * with a blank image. Generating it here means it cannot drift out of sync with
 * the brand again, and there is no binary to keep in the repo.
 *
 * Deliberately does NOT query the job count: social crawlers have short
 * timeouts, and a preview image that sometimes fails to render is worse than
 * one without a number in it.
 */
export const runtime = "nodejs";
export const alt = "Jobsworm — every place recruiters post Israeli tech jobs, in one search";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#FBFAF7",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              background: "#C2521F",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 34, fontWeight: 700, color: "#1F1B16", letterSpacing: "-0.03em" }}>
            Jobsworm
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              color: "#1F1B16",
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Everywhere recruiters</span>
            <span>post jobs.</span>
            <span style={{ color: "#A8441A" }}>All in one place.</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "2px solid #1F1B16",
            paddingTop: 24,
            fontSize: 26,
            color: "#57514A",
          }}
        >
          <div style={{ display: "flex" }}>Israeli tech jobs · straight from employers</div>
          <div style={{ display: "flex", fontWeight: 700, color: "#1F1B16" }}>Free for job seekers</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
