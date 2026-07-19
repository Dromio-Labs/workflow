.PHONY: help setup build check test verify-package local-registry

help:
	@printf "Dromio Workflow commands:\n"
	@printf "  make setup           Install locked dependencies\n"
	@printf "  make build           Build @dromio/workflow and its package closure\n"
	@printf "  make check           Run types, tests, build, and clean-consumer package proof\n"
	@printf "  make local-registry  Build local package-registry artifacts for dro\n"

setup:
	@bun install --frozen-lockfile

build:
	@bun run build

check:
	@bun run check

test:
	@bun run test

verify-package:
	@bun run --cwd packages/sdk verify:package

local-registry:
	@bun run local-registry
