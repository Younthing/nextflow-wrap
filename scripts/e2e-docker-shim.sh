#!/bin/sh
# docker/podman-compatible `run` for machines without a container daemon.
# e2e points TRY_RUN_CONTAINER_BIN here. It is not placed on PATH, so the
# Nextflow runner still sees a missing docker and keeps the Shell engine.
# The argv shape is containerCommand() in src/features/notebook/try-run-env.ts.
set -eu
if [ "${1:-}" != "run" ]; then
  echo "e2e docker shim: expected run, got ${1:-}" >&2
  exit 1
fi
shift
if [ "${1:-}" != "--rm" ]; then
  echo "e2e docker shim: expected --rm" >&2
  exit 1
fi
shift
if [ "${1:-}" != "-v" ]; then
  echo "e2e docker shim: expected -v" >&2
  exit 1
fi
shift
shift
if [ "${1:-}" != "-w" ]; then
  echo "e2e docker shim: expected -w" >&2
  exit 1
fi
shift
workdir=$1
shift
image=$1
shift
echo "e2e docker shim: image ${image}" >&2
cd "$workdir"
exec "$@"
