.PHONY: all help install build clean dev watch test test_watch lint format

# Default target executed when no arguments are given to make.
all: help

######################
# NPM SCRIPT DELEGATION
# All commands now delegate to package.json scripts
######################

install:
	npm run install:ci

build:
	npm run build

clean:
	npm run clean

dev:
	npm run dev

watch:
	npm run watch

test:
	npm test

test_watch:
	npm run test:watch

lint:
	npm run lint

format:
	npm run format

# Legacy compatibility
lint_diff format_diff: lint

######################
# HELP
######################

help:
	@echo ""
	@echo "� MIGRATION NOTICE: This project now uses npm scripts instead of Make"
	@echo ""
	@echo "Use these npm commands directly:"
	@echo "  npm run help     - Show all available commands"
	@echo "  npm test         - Run tests"
	@echo "  npm run build    - Build the project"
	@echo "  npm run lint     - Lint the code"
	@echo ""
	@echo "Or continue using make commands (they delegate to npm):"
	@echo "  make test        - Same as 'npm test'"
	@echo "  make build       - Same as 'npm run build'"
	@echo "  make lint        - Same as 'npm run lint'"
	@echo ""
	@echo "For full command list, run: npm run help"
	@echo ""

