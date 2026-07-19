.PHONY: help setup build check test verify-package local-registry release-rehearse release-verify-next release-publish-next release-promote-latest

help:
	@printf "Dromio Workflow commands:\n"
	@printf "  make setup           Install locked dependencies\n"
	@printf "  make build           Build @dromio/workflow and its package closure\n"
	@printf "  make check           Run types, tests, build, and clean-consumer package proof\n"
	@printf "  make local-registry  Build local package-registry artifacts for dro\n"
	@printf "  make release-rehearse  Build and verify the nine-package release without publishing\n"
	@printf "  make release-verify-next  Verify the public @dromio/workflow@next package\n"

setup:
	@bun install --frozen-lockfile --ignore-scripts

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

release-rehearse:
	@bun run release:rehearse

release-verify-next:
	@bun run release:verify-next

release-publish-next:
	@bun run release:publish-next

release-promote-latest:
	@bun run release:promote-latest
