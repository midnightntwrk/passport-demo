#!/bin/sh
set -eu
# Railway attaches volumes as root. Initialise ownership before dropping all
# runtime processes (the API, compiler, and workers) to the unprivileged user.
if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /data
  chown -R node:node /data
  chmod 700 /data
  exec gosu node "$@"
fi
if [ ! -w /data ]; then
  printf '%s\n' 'The data volume must be writable by uid 1000. Initialise it with the container entrypoint as root.' >&2
  exit 1
fi
exec "$@"
