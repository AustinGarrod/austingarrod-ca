#!/usr/bin/env bash
set -euo pipefail

# Keep this disposable database on the runner's private /tmp filesystem.
fixture="$(mktemp -d /tmp/portfolio-db.XXXXXX)"
database_pid=
cleanup() {
  if [[ -n "$database_pid" ]]; then
    kill "$database_pid" 2>/dev/null || true
    wait "$database_pid" 2>/dev/null || true
  fi
  rm -rf -- "$fixture"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

socket="$fixture/db.sock"
port="$(node -e 'require("node:net").createServer().listen(0, "127.0.0.1", function () { console.log(this.address().port); this.close(); });')"
account="$(id -un)"
mariadb-install-db --no-defaults --datadir="$fixture/data" --auth-root-socket-user="$account" --skip-test-db > "$fixture/install.log" 2>&1 || {
  cat "$fixture/install.log" >&2
  exit 1
}
mariadbd --no-defaults --datadir="$fixture/data" --socket="$socket" --pid-file="$fixture/db.pid" \
  --bind-address=127.0.0.1 --port="$port" --skip-name-resolve > "$fixture/server.log" 2>&1 &
database_pid=$!

local_client=(mariadb --no-defaults --socket="$socket" --user="$account")
for attempt in {1..50}; do
  if "${local_client[@]}" --execute='SELECT 1' >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$database_pid" 2>/dev/null; then
    break
  fi
  sleep 0.2
done
if ! "${local_client[@]}" --execute='SELECT 1' >/dev/null; then
  cat "$fixture/server.log" >&2
  exit 1
fi

password="$(openssl rand -hex 24)"
echo "::add-mask::$password"
"${local_client[@]}" <<SQL
CREATE USER 'portfolio_test'@'127.0.0.1' IDENTIFIED BY '$password';
GRANT ALL PRIVILEGES ON \`accounts\\_test\\_%\`.* TO 'portfolio_test'@'127.0.0.1';
SQL

export ACCOUNTS_TEST_DSN="mysql:host=127.0.0.1;port=$port;charset=utf8mb4"
export ACCOUNTS_TEST_USER=portfolio_test
export ACCOUNTS_TEST_PASSWORD="$password"
"$@"
