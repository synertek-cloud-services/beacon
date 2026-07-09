.PHONY: dev deploy migrate-local migrate-remote db-generate type-check \
        build-agent-windows build-agent-linux build-agent-darwin build-agent-all

AGENT_LDFLAGS := -ldflags="-s -w"

# Worker

dev:
	cd worker && npx wrangler dev

deploy:
	cd worker && npx wrangler deploy

migrate-local:
	cd worker && npx wrangler d1 migrations apply beacon --local

migrate-remote:
	cd worker && npx wrangler d1 migrations apply beacon --remote

db-generate:
	cd worker && npx drizzle-kit generate

type-check:
	cd worker && npx tsc --noEmit

# Agent

build-agent-windows:
	mkdir -p dist
	cd agent && GOOS=windows GOARCH=amd64 go build $(AGENT_LDFLAGS) -o ../dist/agent-windows-amd64.exe ./cmd/agent

build-agent-linux:
	mkdir -p dist
	cd agent && GOOS=linux GOARCH=amd64 go build $(AGENT_LDFLAGS) -o ../dist/agent-linux-amd64 ./cmd/agent

build-agent-darwin:
	mkdir -p dist
	cd agent && GOOS=darwin GOARCH=arm64 go build $(AGENT_LDFLAGS) -o ../dist/agent-darwin-arm64 ./cmd/agent

build-agent-all: build-agent-windows build-agent-linux build-agent-darwin
