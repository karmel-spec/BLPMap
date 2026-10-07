#!/bin/bash
# Deploy the Apps Script bridge (apps-script/DailyReport.gs) with clasp —
# replaces the copy / paste / New version routine (Walter + Karmel 10/7).
#
#   scripts/deploy-bridge.sh            deploy the committed DailyReport.gs
#   scripts/deploy-bridge.sh --check    run every safety check, deploy nothing
#
# What it does, in order:
#   1. refuses if DailyReport.gs has uncommitted changes (only committed code ships)
#   2. pulls the live project and refuses if its code is not a version from this
#      repo's history — someone edited in Google's editor; merge that first
#   3. pushes Code.js + appsscript.json (the only two files the project holds)
#   4. creates a new version and points the EXISTING web-app deployment at it,
#      so the URL never changes and the bridge keeps executing as karmel@
#   5. pings the bridge until it reports the new BRIDGE_REV, or fails loudly
#
# Credential: ~/.clasprc.json (clasp login as karmel@). Script Properties
# (secrets) and installed triggers are never touched by clasp.
set -euo pipefail
LANG=en_US.UTF-8; LC_ALL=en_US.UTF-8; export LANG LC_ALL

CLASP="${CLASP:-$HOME/.blp-tools/node_modules/.bin/clasp}"
DEPLOYMENT_ID="AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt"
BRIDGE_URL="https://script.google.com/macros/s/$DEPLOYMENT_ID/exec"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="apps-script/DailyReport.gs"
DIR="$ROOT/apps-script/clasp"
CHECK_ONLY=0; [ "${1:-}" = "--check" ] && CHECK_ONLY=1

cd "$ROOT"
die() { echo "✗ $*" >&2; exit 1; }
[ -x "$CLASP" ] || die "clasp not found at $CLASP"
"$CLASP" show-authorized-user 2>/dev/null | grep -q "karmel@brighamlarsonpianos.com" \
  || die "clasp is not signed in as karmel@ — run: $CLASP login"

# 1. committed code only
git diff --quiet -- "$SRC" && git diff --cached --quiet -- "$SRC" \
  || die "$SRC has uncommitted changes — commit first"
REV=$(grep -o "var BRIDGE_REV = '[^']*'" "$SRC" | sed "s/.*'\(.*\)'/\1/")
[ -n "$REV" ] || die "no BRIDGE_REV in $SRC"
SHA=$(git rev-parse --short HEAD)

# 2. the live code must be something this repo produced
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cp "$DIR/.clasp.json" "$TMP/.clasp.json"
( cd "$TMP" && "$CLASP" pull >/dev/null ) || die "could not pull the live project"
norm() { python3 -c 'import sys,hashlib; print(hashlib.sha256(open(sys.argv[1],"rb").read().rstrip(b"\n")).hexdigest())' "$1"; }
LIVE=$(norm "$TMP/Code.js")
KNOWN=0
for c in $(git rev-list -n 60 HEAD -- "$SRC"); do
  git show "$c:$SRC" > "$TMP/old.gs" 2>/dev/null || continue
  if [ "$(norm "$TMP/old.gs")" = "$LIVE" ]; then KNOWN=1; LIVE_SHA=$(git rev-parse --short "$c"); break; fi
done
[ "$KNOWN" = 1 ] || die "the live project's code is not in this repo's history — someone edited it in Google's editor. Pulled copy kept for review: cp it out of $TMP before rerunning"
LIVE_REV=$(grep -o "var BRIDGE_REV = '[^']*'" "$TMP/Code.js" | sed "s/.*'\(.*\)'/\1/")
echo "• live project code: rev $LIVE_REV (commit $LIVE_SHA)"
echo "• deploying:         rev $REV (commit $SHA)"
cmp -s "$DIR/appsscript.json" "$TMP/appsscript.json" || die "the live manifest differs from apps-script/clasp/appsscript.json — reconcile it first"
if [ "$CHECK_ONLY" = 1 ]; then echo "✓ checks passed — nothing deployed (--check)"; exit 0; fi

# 3. push exactly two files
cp "$SRC" "$DIR/Code.js"
( cd "$DIR" && "$CLASP" push ) || die "push failed"
rm -f "$DIR/Code.js"

# 4. new version → existing deployment
VOUT=$( cd "$DIR" && "$CLASP" create-version "rev $REV ($SHA)" )
VER=$(echo "$VOUT" | grep -o '[0-9]\+' | tail -1)
[ -n "$VER" ] || die "could not read the new version number from: $VOUT"
( cd "$DIR" && "$CLASP" update-deployment "$DEPLOYMENT_ID" -V "$VER" -d "rev $REV ($SHA)" ) || die "update-deployment failed (version $VER was created)"
echo "• deployment now on version $VER"

# 5. prove it
for i in $(seq 1 12); do
  GOT=$(curl -sL "$BRIDGE_URL?fn=ping&nc=$RANDOM" | grep -o '"rev":"[^"]*"' | sed 's/"rev":"\(.*\)"/\1/' || true)
  if [ "$GOT" = "$REV" ]; then echo "✓ bridge is live on rev $REV (version $VER)"; exit 0; fi
  sleep 10
done
die "deployed version $VER, but the bridge still reports rev '${GOT:-?}' instead of $REV"
