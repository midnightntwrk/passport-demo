#!/bin/sh
set -eu

# Published GitHub release asset SHA-256 digests, checked on 2026/09/14.
# Both the manager and compiler archive are verified before execution.
manager_version=0.5.2
compiler_version=0.34.0
toolchain_root=${BUILDER_TOOLCHAIN_ROOT:-/opt/compact}
binary_root=${BUILDER_BINARY_ROOT:-/usr/local/bin}

case "$(uname -m)" in
  x86_64|amd64)
    platform=x86_64-unknown-linux-musl
    manager_sha=da594f9edfe8d87312c0c500443702b5cfa9d7e17c43433b6ed6580a36278ac8
    compiler_sha=775ccddf5a71399835329bbf7471ba5a8c54fcc825d372c75e19ba7042069584
    ;;
  aarch64|arm64)
    platform=aarch64-unknown-linux-musl
    manager_sha=853180a16dc4115f4f794b1de0aae43573dcc65b6c75225c11520b0df203dd72
    compiler_sha=d3e292c4f48e257dcd6b3d3e3e4743d7d8ea0729f48953eab91a366d44cd026d
    ;;
  *) printf '%s\n' 'Unsupported Linux architecture for Compact.' >&2; exit 1 ;;
esac
if [ "$(uname -s)" != Linux ]; then
  printf '%s\n' 'This installer is for Linux containers. Locally use compact update --no-set-default 0.34.0.' >&2
  exit 1
fi

install_tmp=$(mktemp -d)
trap 'rm -rf "$install_tmp"' EXIT HUP INT TERM
base=https://github.com/midnightntwrk/compact/releases/download
curl --fail --location --silent --show-error --retry 3 --proto '=https' --tlsv1.2 \
  "$base/compact-v$manager_version/compact-$platform.tar.xz" -o "$install_tmp/manager.tar.xz"
printf '%s  %s\n' "$manager_sha" "$install_tmp/manager.tar.xz" | sha256sum --check --status
tar -xJf "$install_tmp/manager.tar.xz" -C "$install_tmp"
mkdir -p "$binary_root"
install -m 0755 "$install_tmp/compact-$platform/compact" "$binary_root/compact"

curl --fail --location --silent --show-error --retry 3 --proto '=https' --tlsv1.2 \
  "$base/compactc-v$compiler_version/compactc_v${compiler_version}_$platform.zip" -o "$install_tmp/compiler.zip"
printf '%s  %s\n' "$compiler_sha" "$install_tmp/compiler.zip" | sha256sum --check --status
compiler_dir="$toolchain_root/versions/$compiler_version/$platform"
mkdir -p "$compiler_dir"
unzip -q "$install_tmp/compiler.zip" -d "$compiler_dir"
chmod +x "$compiler_dir/compactc" "$compiler_dir/compactc.bin" "$compiler_dir/zkir"
COMPACT_DIRECTORY="$toolchain_root" "$binary_root/compact" compile +0.34.0 --version
COMPACT_DIRECTORY="$toolchain_root" "$binary_root/compact" compile +0.34.0 --ledger-version

# A successful binary version check alone does not prove proving-key generation works.
printf '%s\n' 'pragma language_version >= 0.22;' 'import CompactStandardLibrary;' \
  'export ledger count: Counter;' 'constructor() {}' \
  'export circuit increment(): [] { count.increment(1); }' > "$install_tmp/check.compact"
COMPACT_DIRECTORY="$toolchain_root" "$binary_root/compact" compile +0.34.0 "$install_tmp/check.compact" "$install_tmp/managed"
test -s "$install_tmp/managed/keys/increment.prover"
test -s "$install_tmp/managed/keys/increment.verifier"
test -s "$install_tmp/managed/zkir/increment.bzkir"
