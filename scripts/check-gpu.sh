#!/usr/bin/env bash
# Verifica se a máquina local é compatível com `make start-gpu`
# (vision-service com GPU via NVIDIA Container Toolkit — SPEC §34).
# Uso: ./scripts/check-gpu.sh [--full]
#   --full  roda um smoke test em container (nvidia/cuda) além das checagens locais.
# Exit 0 = compatível, 1 = incompatível.
set -uo pipefail

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; }
say()  { printf '%s\n' "$1"; }

say "Checando compatibilidade com start-gpu..."

# 1. GPU NVIDIA só funciona em Linux nativo (ou WSL2). O Colima do macOS
#    usa Virtualization.Framework sem passthrough de GPU PCIe.
if [ "$(uname -s)" = "Darwin" ]; then
  fail "macOS detectado: NVIDIA Container Toolkit não funciona no Colima (sem GPU NVIDIA/passthrough). Use 'make start' (CPU)."
  exit 1
fi
ok "Sistema operacional: $(uname -s) (GPU NVIDIA suportada)"

# 2. Driver NVIDIA instalado e funcionando.
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  ok "Driver NVIDIA: $(nvidia-smi -L | head -1)"
else
  fail "nvidia-smi não encontrado ou driver NVIDIA não funcionando."
  exit 1
fi

# 3. NVIDIA Container Toolkit instalado.
if command -v nvidia-ctk >/dev/null 2>&1; then
  ok "NVIDIA Container Toolkit instalado ($(nvidia-ctk --version 2>/dev/null | head -1))"
else
  fail "NVIDIA Container Toolkit não instalado. Veja https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/"
  exit 1
fi

# 4. Runtime 'nvidia' visível para o Docker.
if docker info 2>/dev/null | grep -q 'nvidia'; then
  ok "Runtime 'nvidia' disponível no Docker"
else
  fail "Runtime 'nvidia' não aparece no 'docker info'. Configure com: sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker"
  exit 1
fi

# 5. Smoke test opcional em container (--full).
if [ "${1:-}" = "--full" ]; then
  say "Rodando smoke test em container (--gpus all)..."
  if docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1; then
    ok "Container enxerga a GPU (nvidia-smi dentro do container OK)"
  else
    fail "Container não conseguiu usar a GPU. Verifique o NVIDIA Container Toolkit."
    exit 1
  fi
fi

say ""
say "Compatível com 'make start-gpu'. Para validar de ponta a ponta, rode: ./scripts/check-gpu.sh --full"
exit 0
