import { JetBrains_Mono, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";

// CJK fonts ship as many unicode-range slices; preloading them all would
// waste bandwidth, so the browser fetches only the slices a page needs.
export const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const notoSerifSC = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});
