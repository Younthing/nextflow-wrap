#!/bin/sh
# Stand-in for ssh in tests and demos (NEXTFLOW_STUDIO_SSH=scripts/ssh-shim.sh): drops ssh's options and the
# destination, then runs the remote command on this machine with stdin passed through.
while [ $# -gt 0 ]; do
  case "$1" in
    --) shift; shift; break ;;
    -o|-p|-i|-l) shift 2 ;;
    *) shift ;;
  esac
done
exec sh -c "$*"
