# Editorial Motion — comandos locais (Docker Compose via Colima no macOS).
COMPOSE_FILE := infra/compose/docker-compose.yml
COMPOSE_GPU_FILE := infra/compose/docker-compose.gpu.yml
DOCKER_COMPOSE := docker compose -f $(COMPOSE_FILE)

.PHONY: help setup build start start-gpu check-gpu dev dev-stop stop down logs ps clean

help: ## Lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-12s %s\n", $$1, $$2}'

setup: ## Instala hooks, .env e dependências pnpm
	./scripts/install-hooks.sh
	[ -f .env ] || cp .env.example .env
	pnpm install

colima-start: ## Garante que o Colima (daemon Docker) está rodando
	@colima status >/dev/null 2>&1 || colima start

build: colima-start ## Faz build das imagens Docker
	$(DOCKER_COMPOSE) build

start: colima-start ## Sobe todos os serviços (web em http://localhost:3001)
	$(DOCKER_COMPOSE) up --build

check-gpu: ## Testa se a máquina é compatível com start-gpu (GPU NVIDIA + Container Toolkit)
	./scripts/check-gpu.sh

start-gpu: check-gpu colima-start ## Sobe os serviços com GPU no vision-service (requer NVIDIA Container Toolkit)
	docker compose -f $(COMPOSE_FILE) -f $(COMPOSE_GPU_FILE) up --build

# Modo desenvolvimento no host (web/api/renderer via pnpm) com redis+postgres
# no Docker — recomendado no macOS, onde a VM do Colima rouba RAM/CPU do render.
dev: colima-start ## Sobe redis+postgres no Docker e roda web/api/renderer no host (Ctrl+C para sair)
	$(DOCKER_COMPOSE) up -d redis postgres
	pnpm dev

dev-stop: ## Para os containers de apoio (redis/postgres) do make dev
	$(DOCKER_COMPOSE) stop redis postgres

stop: ## Para os containers sem removê-los
	$(DOCKER_COMPOSE) stop

down: ## Para e remove os containers
	$(DOCKER_COMPOSE) down

logs: ## Acompanha os logs de todos os serviços
	$(DOCKER_COMPOSE) logs -f

ps: ## Lista o status dos serviços
	$(DOCKER_COMPOSE) ps

clean: ## Para os containers e remove os volumes (api-data, pg-data)
	$(DOCKER_COMPOSE) down -v
