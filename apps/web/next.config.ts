import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Static export. The app talks to Starknet directly from the browser, so
   * there is nothing for a server to do — and shipping a static bundle means
   * no build step runs on the host, no package registry credentials are needed
   * to deploy it, and there is no server-side place for a secret to leak.
   */
  output: "export",

  /** The shared package ships TypeScript source rather than a build. */
  transpilePackages: ["@oojae/strk20-governance"],

  images: { unoptimized: true },
};

export default nextConfig;
