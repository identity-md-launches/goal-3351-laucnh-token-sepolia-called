#!/usr/bin/env bash
# Regenerates contract-artifacts/TestToken.json and TestStaking.json from a real
# Foundry compilation of src/ (solc 0.8.28, Foundry defaults, no config changes).
# Usage (from repository root):  bash contract-artifacts/generate.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/imd-contract-out"
rm -rf "$OUT"
forge build --offline --use 0.8.28 --contracts src --skip test --out "$OUT" --cache-path "$OUT/cache" --force
for C in TestToken TestStaking; do
  jq --arg c "$C" --arg src "src/$C.sol" '{
      contractName: $c,
      sourceName: $src,
      compiler: (.metadata.compiler),
      abi: .abi,
      bytecode: .bytecode.object,
      deployedBytecode: .deployedBytecode.object,
      metadata: (.rawMetadata // (.metadata | tojson))
    }' "$OUT/$C.sol/$C.json" > "contract-artifacts/$C.json"
  test "$(jq -r '.bytecode | length' "contract-artifacts/$C.json")" -gt 2
done
sha256sum src/TestToken.sol src/TestStaking.sol contract-artifacts/TestToken.json contract-artifacts/TestStaking.json
