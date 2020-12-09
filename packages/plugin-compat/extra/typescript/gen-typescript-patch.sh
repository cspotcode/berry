set -ex

THIS_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
node -r "$THIS_DIR/../../../../scripts/setup-ts-execution.js" "$THIS_DIR/gen-typescript-patch.ts" "$@"
