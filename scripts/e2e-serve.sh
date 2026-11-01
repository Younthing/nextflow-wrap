#!/usr/bin/env bash
# Starts the real runner and the Next.js app for the Playwright user-path tests.
# Shell execution is enough: the published container/conda lines are still written
# into the process, and Nextflow runs python3 or Rscript on this machine.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

export PATH="${HOME}/.local/bin:${PATH}"
export NEXTFLOW_STUDIO_DATA_DIR="${NEXTFLOW_STUDIO_DATA_DIR:-/tmp/nextflow-studio-e2e}"
export NEXT_PUBLIC_API_MOCKING=disabled
export NXF_DISABLE_CHECK_LATEST="${NXF_DISABLE_CHECK_LATEST:-true}"
export NXF_ANSI_LOG="${NXF_ANSI_LOG:-false}"
port="${E2E_PORT:-3010}"

mkdir -p "${NEXTFLOW_STUDIO_DATA_DIR}/envs"
if [[ ! -f "${NEXTFLOW_STUDIO_DATA_DIR}/envs/py311-pandas.yml" ]]; then
  cat > "${NEXTFLOW_STUDIO_DATA_DIR}/envs/py311-pandas.yml" <<'EOF'
name: py311-pandas
channels:
  - conda-forge
dependencies:
  - python=3.11
EOF
fi
if [[ ! -f "${NEXTFLOW_STUDIO_DATA_DIR}/envs/r-deseq2.yml" ]]; then
  cat > "${NEXTFLOW_STUDIO_DATA_DIR}/envs/r-deseq2.yml" <<'EOF'
name: r-deseq2
channels:
  - conda-forge
  - bioconda
dependencies:
  - r-base=4.3
EOF
fi

runner_log="${NEXTFLOW_STUDIO_DATA_DIR}/runner.log"
: > "${runner_log}"
pnpm runner >> "${runner_log}" 2>&1 &
runner_pid=$!
web_pid=""

cleanup() {
  # Children stay in this shell's process group so Playwright can stop the whole server.
  if [[ -n "${web_pid}" ]]; then
    kill "${web_pid}" 2>/dev/null || true
  fi
  kill "${runner_pid}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 180); do
  if grep -q "Runner ready" "${runner_log}"; then
    break
  fi
  if ! kill -0 "${runner_pid}" 2>/dev/null; then
    echo "Runner exited before it was ready." >&2
    cat "${runner_log}" >&2
    exit 1
  fi
  sleep 1
done
if ! grep -q "Runner ready" "${runner_log}"; then
  echo "Runner did not become ready." >&2
  cat "${runner_log}" >&2
  exit 1
fi

# Next reads PORT. Passing --port through pnpm made Next treat "--port" as the app directory.
export PORT="${port}"
if [[ "${E2E_DEV:-}" == "1" ]]; then
  pnpm dev:real &
else
  pnpm start &
fi
web_pid=$!
wait "${web_pid}"
