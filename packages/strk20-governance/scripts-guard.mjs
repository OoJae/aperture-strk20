/**
 * Refuse to pack or publish under npm.
 *
 * package.json points `main` and `types` at TypeScript source, because that is
 * what the workspace consumes — apps/web transpiles it and the tally service
 * runs it directly, with no build step between editing a helper and running a
 * tally. `publishConfig` redirects those fields to dist/ for consumers.
 *
 * Field overrides in publishConfig are a **pnpm** feature. npm treats
 * publishConfig as npm *config* keys only, warns "Unknown publishConfig config"
 * about the rest, and ships package.json unchanged — so `npm publish` uploads a
 * package whose entry point is a .ts file that no consumer can import.
 *
 * That is exactly what happened to 0.1.0. The warnings scrolled past in a wall
 * of tarball listing and the publish reported success.
 */
const ua = process.env.npm_config_user_agent ?? "";
if (!ua.includes("pnpm")) {
  console.error(
    "\nRefusing to pack/publish under npm.\n\n" +
      "  This package relies on publishConfig field overrides (main, types,\n" +
      "  exports) to point consumers at dist/ while the workspace runs src/.\n" +
      "  Those are a pnpm feature. npm ignores them and would publish a package\n" +
      "  whose entry point is TypeScript source.\n\n" +
      "  Use:  pnpm publish --access public\n" +
      `  (detected user agent: ${ua || "none"})\n`,
  );
  process.exit(1);
}
