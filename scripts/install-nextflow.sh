#!/usr/bin/env bash
# Install the Nextflow release this repo runs in CI and in preflight.
# The launcher is the official GitHub release asset (not Conda):
# https://github.com/nextflow-io/nextflow/releases/download/v26.10.4/nextflow
# https://docs.seqera.io/nextflow/install
#
# Java 17–26 must already be on PATH. This script does not install a JDK.
# The pipeline manifest minimum (NEXTFLOW_VERSION in templates.ts) is older
# than this runtime pin; keep the default aligned with preflight.ts NXF_VER.
set -euo pipefail

VERSION="${NXF_VER:-26.10.4}"
PREFIX="${NEXTFLOW_PREFIX:-/usr/local/bin}"

if ! command -v java >/dev/null 2>&1; then
  echo "Nextflow requires Java 17–26 on PATH. Install a JDK, then re-run scripts/install-nextflow.sh." >&2
  exit 1
fi

java_major="$(java -version 2>&1 | sed -n 's/.* version "\([0-9][0-9]*\).*/\1/p' | head -n 1)"
if [[ -z "${java_major}" || "${java_major}" -lt 17 || "${java_major}" -gt 26 ]]; then
  echo "Nextflow requires Java 17–26. Found: $(java -version 2>&1 | head -n 1)" >&2
  exit 1
fi

report_version() {
  env -u NXF_VER NXF_DISABLE_CHECK_LATEST=true NXF_ANSI_LOG=false nextflow -version 2>&1 || true
}

if command -v nextflow >/dev/null 2>&1; then
  current="$(report_version)"
  if printf '%s\n' "${current}" | grep -q "version ${VERSION} "; then
    printf '%s\n' "${current}"
    exit 0
  fi
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT
curl -fsSL -o "${tmpdir}/nextflow" "https://github.com/nextflow-io/nextflow/releases/download/v${VERSION}/nextflow"
chmod 755 "${tmpdir}/nextflow"

if [[ -w "${PREFIX}" ]]; then
  install -m 755 "${tmpdir}/nextflow" "${PREFIX}/nextflow"
else
  sudo install -m 755 "${tmpdir}/nextflow" "${PREFIX}/nextflow"
fi

current="$(report_version)"
printf '%s\n' "${current}"
printf '%s\n' "${current}" | grep -q "version ${VERSION} "
