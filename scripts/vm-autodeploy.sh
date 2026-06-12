#!/usr/bin/env bash
# Check-and-deploy for the Shinobi VM. Runs on the HOST, never inside the
# container — the container cannot `docker rm` itself mid-deploy.
#
# Designed for cron (silent no-op when main is unchanged):
#   */5 * * * * $HOME/shinobi/scripts/vm-autodeploy.sh >> $HOME/shinobi-autodeploy.log 2>&1
#
# Flow: fetch origin/main → if new commits: build image FIRST (old container
# keeps serving during the slow e2-micro build), then swap containers reusing
# the old container's SHINOBI_*/provider env, health-check the new one, and
# roll back to the previous image if it doesn't come up.

set -euo pipefail

REPO_DIR="${SHINOBI_REPO_DIR:-$HOME/shinobi}"
CONTAINER="${SHINOBI_CONTAINER:-shinobi}"
IMAGE="${SHINOBI_IMAGE:-shinobi}"
BRANCH="${SHINOBI_DEPLOY_BRANCH:-main}"
HEALTH_URL="${SHINOBI_HEALTH_URL:-http://127.0.0.1:8765/health}"
PORT_MAPPING="${SHINOBI_PORT_MAPPING:-127.0.0.1:8765:8765}"
VOLUME_MAPPING="${SHINOBI_VOLUME_MAPPING:-shinobi-data:/data}"
LOCK_FILE="${SHINOBI_DEPLOY_LOCK:-/tmp/shinobi-autodeploy.lock}"

log() { echo "[shinobi-autodeploy] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# Never run two deploys at once (cron tick during a 15-minute build).
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another deploy is in progress, exiting"
  exit 0
fi

git -C "$REPO_DIR" fetch origin "$BRANCH" --quiet
LOCAL=$(git -C "$REPO_DIR" rev-parse HEAD)
REMOTE=$(git -C "$REPO_DIR" rev-parse "origin/$BRANCH")
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi
log "new commits on $BRANCH: ${LOCAL:0:7} -> ${REMOTE:0:7}"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  log "container '$CONTAINER' not found — do the first deploy manually (docs/deploy-gcp-free.md), then enable autodeploy"
  exit 1
fi

# Carry over runtime config (dashboard token, LLM/embedding provider keys)
# from the running container so a swap never loses configuration.
ENV_ARGS=()
while IFS= read -r line; do
  ENV_ARGS+=(-e "$line")
done < <(
  docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' |
    grep -E '^(SHINOBI_|GROQ_|OPENAI_|VOYAGE_|ANTHROPIC_)' || true
)

git -C "$REPO_DIR" reset --hard "origin/$BRANCH" --quiet

# Build BEFORE stopping: minutes of build, seconds of swap. A failed build
# leaves the old container running untouched (set -e aborts here).
docker tag "$IMAGE:latest" "$IMAGE:previous" 2>/dev/null || true
log "building image (slow on e2-micro — this is normal)"
docker build -t "$IMAGE" "$REPO_DIR" >/dev/null

run_container() {
  local image_ref="$1"
  docker run -d --name "$CONTAINER" --restart unless-stopped \
    -p "$PORT_MAPPING" \
    -v "$VOLUME_MAPPING" \
    "${ENV_ARGS[@]}" \
    "$image_ref" >/dev/null
}

wait_healthy() {
  for _ in $(seq 1 12); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

log "swapping container"
docker stop "$CONTAINER" >/dev/null
docker rm "$CONTAINER" >/dev/null
run_container "$IMAGE:latest"

if wait_healthy; then
  log "deploy OK at ${REMOTE:0:7}: $(curl -fsS "$HEALTH_URL")"
  exit 0
fi

log "health check FAILED — rolling back to previous image"
docker stop "$CONTAINER" >/dev/null 2>&1 || true
docker rm "$CONTAINER" >/dev/null 2>&1 || true
run_container "$IMAGE:previous"
if wait_healthy; then
  log "rollback OK — investigate the failed commit before re-enabling: ${REMOTE:0:7}"
else
  log "ROLLBACK ALSO FAILED — manual intervention required (docs/recovery-runbook.md procedure A)"
fi
exit 1
