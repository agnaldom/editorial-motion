#!/usr/bin/env bash
set -euo pipefail

mode="${1:-full}"
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

fail() { printf 'quality-gate: %s\n' "$1" >&2; exit 1; }

if git diff --cached --name-only | rg -i '(^|/)(\.env|.*\.pem|.*\.key|id_rsa)(\.|$)' >/dev/null; then
  fail 'arquivo sensível detectado no commit; remova-o do stage.'
fi

if git diff --cached --name-only | rg -i '\.(mp4|mov|avi|mkv|pyc|pyo)$|(^|/)(node_modules|\.venv|dist|build|data)/' >/dev/null; then
  fail 'artefato ou diretório gerado detectado no commit; remova-o do stage.'
fi

if [[ "$mode" == "quick" ]]; then
  exit 0
fi

if [[ -f package.json && ( -f pnpm-lock.yaml || -f package-lock.json || -f yarn.lock ) ]]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm run lint
    pnpm run typecheck
    pnpm run test
  elif command -v npm >/dev/null 2>&1; then
    npm run lint --if-present
    npm run typecheck --if-present
    npm test --if-present
  else
    fail 'package.json encontrado, mas pnpm/npm não está instalado.'
  fi
elif [[ -f package.json ]]; then
  printf 'quality-gate: checks JS adiados até o bootstrap do package manager (lockfile ausente)\n'
fi

if [[ -d apps/vision-service || -d vision-service ]]; then
  command -v python >/dev/null 2>&1 || fail 'vision-service encontrado, mas Python não está instalado.'
  if [[ -f pyproject.toml ]]; then python -m pytest; fi
  if [[ -f requirements.txt && ! -f pyproject.toml ]]; then python -m compileall -q apps/vision-service vision-service 2>/dev/null || true; fi
fi

printf 'quality-gate: checks concluídos (%s)\n' "$mode"
