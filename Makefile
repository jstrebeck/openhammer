.PHONY: install dev dev-server build test test-watch test-core test-client \
       typecheck typecheck-core typecheck-client typecheck-server clean lint format help \
       docker-build docker-up docker-down docker-logs docker-push

# Default target
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Setup
install: ## Install all dependencies
	npm install

# Development
dev: ## Start the client dev server (Vite)
	npm run dev -w packages/client

dev-server: ## Start the backend dev server (tsx watch)
	npm run dev -w packages/server

dev-all: ## Start client and server in parallel
	npx concurrently -n client,server -c blue,green \
		"npm run dev -w packages/client" \
		"npm run dev -w packages/server"

# Build
build: ## Build all packages (core -> client -> server)
	npm run build -w packages/core && \
	npm run build -w packages/client && \
	npm run build -w packages/server

build-core: ## Build core package only
	npm run build -w packages/core

build-client: ## Build client package only
	npm run build -w packages/client

build-server: ## Build server package only
	npm run build -w packages/server

# Testing
test: ## Run all tests once
	npx vitest run --workspace vitest.workspace.ts

test-watch: ## Run all tests in watch mode
	npx vitest --workspace vitest.workspace.ts

test-core: ## Run core tests only
	npx vitest run --workspace vitest.workspace.ts --project @openhammer/core

test-client: ## Run client tests only
	npx vitest run --workspace vitest.workspace.ts --project @openhammer/client

test-coverage: ## Run tests with coverage report
	npx vitest run --workspace vitest.workspace.ts --coverage

# Type checking
typecheck: typecheck-core typecheck-client typecheck-server ## Type-check all packages

typecheck-core: ## Type-check core package
	npx tsc -p packages/core/tsconfig.json --noEmit

typecheck-client: ## Type-check client package
	npx tsc -p packages/client/tsconfig.json --noEmit

typecheck-server: ## Type-check server package
	npx tsc -p packages/server/tsconfig.json --noEmit

# Cleaning
clean: ## Remove all build artifacts and node_modules
	rm -rf packages/core/dist packages/client/dist packages/server/dist
	rm -rf node_modules packages/*/node_modules
	rm -f packages/*/*.tsbuildinfo

clean-dist: ## Remove build artifacts only (keep node_modules)
	rm -rf packages/core/dist packages/client/dist packages/server/dist
	rm -f packages/*/*.tsbuildinfo

# Docker
REGISTRY := 192.168.2.203:5000

docker-build: ## Build Docker images for client and server
	docker build -t $(REGISTRY)/openhammer/client:latest -f infrastructure/Dockerfile.client .
	docker build -t $(REGISTRY)/openhammer/server:latest -f infrastructure/Dockerfile.server .

docker-push: docker-build ## Build and push images to registry
	docker push $(REGISTRY)/openhammer/client:latest
	docker push $(REGISTRY)/openhammer/server:latest

docker-up: ## Start all services via Docker Compose
	docker compose -f infrastructure/docker-compose.yml up -d

docker-down: ## Stop all Docker Compose services
	docker compose -f infrastructure/docker-compose.yml down

docker-logs: ## Tail logs from Docker Compose services
	docker compose -f infrastructure/docker-compose.yml logs -f

# Utilities
preview: build-client ## Build and preview the client production bundle
	npx vite preview --config packages/client/vite.config.ts
