import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aperture — sealed-ballot governance on STRK20",
  description:
    "Sealed-ballot DAO voting and a shielded treasury, native to the STRK20 shielded pool on Starknet mainnet.",
  icons: { icon: "/aperture.svg" },
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
