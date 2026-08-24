#!/bin/zsh
# Build and deploy the demo to production.
#
#   scripts/deploy-site.sh
#
# The indirection here is not decoration. Three things about this project make
# the obvious command wrong:
#
#   1. `vercel deploy out` names the project after the DIRECTORY. It ignores the
#      link in the current directory and deploys to a project called "out",
#      creating one if needed. That happened; the stray project had to be
#      deleted afterwards.
#   2. The Vercel project's Root Directory is `.` and its framework preset is
#      "Other", so deploying from apps/web would run the repo-root build command
#      and look for output in `public` or `.` — none of which produce this site.
#      What works is uploading the finished static export as the deployment.
#   3. `vercel.json` must therefore live INSIDE the export. It sits in
#      apps/web/public/ so Next copies it to out/, which is the only path that
#      gets cleanUrls applied. Moving it to apps/web/vercel.json looks tidier
#      and silently disables it.
#
# So: build, put the project link inside out/, and deploy from inside out/.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=aperture-strk20
SCOPE=oojaes-projects

echo "1. Building"
(cd apps/web && pnpm build >/dev/null)

if [[ ! -f apps/web/out/vercel.json ]]; then
  echo "   apps/web/out/vercel.json is missing — cleanUrls would be lost."
  echo "   It belongs in apps/web/public/ so the export copies it here."
  exit 1
fi

echo "2. Linking out/ to $PROJECT"
mkdir -p apps/web/out/.vercel
if [[ ! -f apps/web/.vercel/project.json ]]; then
  (cd apps/web && vercel link --project "$PROJECT" --yes --scope "$SCOPE")
fi
cp apps/web/.vercel/project.json apps/web/out/.vercel/project.json
grep -q "\"projectName\":\"$PROJECT\"" apps/web/out/.vercel/project.json || {
  echo "   out/.vercel does not point at $PROJECT. Refusing to deploy."; exit 1; }

echo "3. Deploying to production"
(cd apps/web/out && vercel deploy --prod --yes --scope "$SCOPE")

echo
echo "4. Verifying the live site"
for p in / /how /proof /trust /app; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "https://$PROJECT.vercel.app$p")
  printf "   %-8s %s\n" "$p" "$code"
done
redir=$(curl -sS -o /dev/null -w '%{http_code}' "https://$PROJECT.vercel.app/how.html")
[[ "$redir" == "308" ]] && echo "   cleanUrls active (/how.html -> 308)" \
                        || echo "   WARNING: /how.html returned $redir, expected 308 — cleanUrls may be off"
