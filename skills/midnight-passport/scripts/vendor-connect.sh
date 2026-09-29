#!/usr/bin/env bash
# Build @midnight-passport/connect from a tagged Passport release and drop the
# tarball into a project, because the package is not published to npm.
#
#   vendor-connect.sh <project-dir> [git-ref]
#
# <project-dir>  the app that will depend on the package (must hold package.json)
# [git-ref]      a tag, branch, or commit of midnightntwrk/passport-demo (default v5.0)
#
# Result: <project-dir>/vendor/midnight-passport-connect-<version>.tgz, and the
# exact `npm install` line to run. Nothing in <project-dir> is changed apart
# from that one file; the package.json edit is yours to make (the script prints it).
#
# Why a copy and not `npm install` inside the clone: packages/connect is a member
# of the repository's npm workspace, and installing there installs the whole
# workspace (the Midnight toolchain included). Copied out, it needs only its own
# three runtime libraries and TypeScript.
set -euo pipefail

project="${1:?usage: vendor-connect.sh <project-dir> [git-ref]}"
ref="${2:-v5.0}"
repo="${PASSPORT_REPO:-https://github.com/midnightntwrk/passport-demo.git}"

[ -f "$project/package.json" ] || { echo "no package.json in $project" >&2; exit 1; }
project="$(cd "$project" && pwd)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Fetching packages/connect at $ref from $repo" >&2
git clone --quiet --depth 1 --branch "$ref" --filter=blob:none --sparse "$repo" "$work/repo" 2>/dev/null \
  || { git clone --quiet --filter=blob:none --sparse "$repo" "$work/repo" && git -C "$work/repo" checkout --quiet "$ref"; }
git -C "$work/repo" sparse-checkout set packages/connect >/dev/null

cp -R "$work/repo/packages/connect" "$work/connect"
cd "$work/connect"
# `prepare` runs tsc and emits dist/; --no-audit/--no-fund keep the output short.
npm install --no-audit --no-fund --loglevel=error >/dev/null
tarball="$(npm pack --silent | tail -n 1)"

mkdir -p "$project/vendor"
cp "$tarball" "$project/vendor/"
version="$(node -p "require('./package.json').version")"
commit="$(git -C "$work/repo" rev-parse --short HEAD)"

cat <<EOF
Built @midnight-passport/connect $version from $ref ($commit).
  $project/vendor/$tarball

Install it:
  cd $project && npm install ./vendor/$tarball

That writes "@midnight-passport/connect": "file:vendor/$tarball" into package.json.
Commit the tarball with the app so a fresh clone installs the same bytes.
EOF
