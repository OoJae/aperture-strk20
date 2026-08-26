import type { Metadata, Viewport } from "next";
import { DEMO_URL } from "@oojae/strk20-governance";
import type { ReactNode } from "react";
import "./globals.css";

const TITLE = "Aperture — sealed-ballot governance on STRK20";
const DESCRIPTION =
  "Sealed-ballot DAO voting and a shielded treasury, native to the STRK20 shielded pool on Starknet mainnet.";

/**
 * Social metadata, because the demo is shared as a link before it is opened.
 *
 * Without these a paste into Discord, Slack or Telegram renders a bare URL, and
 * that is where this gets judged. The card image is deliberately free of any
 * number that can go stale — it carries the thesis and the address, nothing
 * that has to be kept in sync with the chain.
 */
export const metadata: Metadata = {
  metadataBase: new URL(DEMO_URL),
  title: TITLE,
  description: DESCRIPTION,
  icons: { icon: "/aperture.svg" },
  openGraph: {
    type: "website",
    siteName: "Aperture",
    url: DEMO_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Aperture — votes go in sealed. Only the total comes out.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
