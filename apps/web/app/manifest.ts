import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jobsworm",
    short_name: "Jobsworm",
    description: "Every place recruiters post Israeli tech jobs, in one search",
    lang: "en",
    dir: "ltr",
    // An installed app should open on the tool, not the marketing page.
    start_url: "/jobs?src=pwa",
    display: "standalone",
    background_color: "#FBFAF7",
    theme_color: "#FBFAF7",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Search jobs", url: "/jobs" },
      { name: "Saved jobs", url: "/me" },
    ],
  };
}
