#!/usr/bin/env bash
# W65 (D1, D65-2, D65-7): run Playwright inside the pinned image as linux/amd64,
# the same platform GitHub runners use, so baselines made on an Apple-silicon Mac
# match CI. The repo is copied into the container WITHOUT node_modules/target/.git/.claude,
# deps are installed there with Linux binaries, and only e2e/__screenshots__,
# test-results/ and playwright-report/ are copied back to the host.
#
# Usage: scripts/e2e-docker.sh [playwright test args...]
#   scripts/e2e-docker.sh --project=canvas2d --update-snapshots=all e2e/acceptance.spec.ts
#   scripts/e2e-docker.sh --project=webgpu
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PW_VERSION="$(node -p "require('${ROOT}/package.json').devDependencies['@playwright/test']")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"

if [[ ! "${PW_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "[e2e-docker] @playwright/test must be pinned to an exact version, got '${PW_VERSION}'" >&2
  exit 1
fi
if [[ ! -f "${ROOT}/pkg/liquiddom_bg.wasm" ]]; then
  echo "[e2e-docker] pkg/ is missing - run 'npm run build:wasm' first" >&2
  exit 1
fi

mkdir -p "${ROOT}/e2e/__screenshots__" "${ROOT}/test-results" "${ROOT}/playwright-report"
echo "[e2e-docker] ${IMAGE} (linux/amd64): playwright test $*"

docker run --rm --platform linux/amd64 --ipc=host \
  -e CI=1 \
  -e E2E_SUITE="${E2E_SUITE:-docker}" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "${ROOT}:/src:ro" \
  -v "${ROOT}/e2e/__screenshots__:/out/screenshots" \
  -v "${ROOT}/test-results:/out/test-results" \
  -v "${ROOT}/playwright-report:/out/playwright-report" \
  -v liquiddom-e2e-npm-cache:/root/.npm \
  "${IMAGE}" \
  bash -euo pipefail -c '
    mkdir -p /work
    tar -C /src --exclude=node_modules --exclude=./target --exclude=./.git --exclude=./.claude \
      --exclude=./test-results --exclude=./playwright-report -cf - . | tar -C /work -xf -
    cd /work
    npm ci --no-audit --no-fund
    status=0
    npx playwright test "$@" || status=$?
    cp -R e2e/__screenshots__/. /out/screenshots/ 2>/dev/null || true
    cp -R test-results/. /out/test-results/ 2>/dev/null || true
    cp -R playwright-report/. /out/playwright-report/ 2>/dev/null || true
    chown -R "${HOST_UID}:${HOST_GID}" /out/screenshots /out/test-results /out/playwright-report || true
    exit "${status}"
  ' bash "$@"
