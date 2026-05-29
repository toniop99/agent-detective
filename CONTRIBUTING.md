# Contributing to Agent Detective

First off, thank you for considering contributing to Agent Detective! It's people like you that make Agent Detective such a great tool.

## Getting Started

Agent Detective is a TypeScript monorepo using **pnpm** and **Turborepo**.

### Prerequisites

- [Node.js](https://nodejs.org/en/) version 24 or higher
- [pnpm](https://pnpm.io/) version 10

### Installation

1. Fork the repository and clone it locally.
2. Install dependencies:
   ```bash
   pnpm install
   ```

### Local Development

To start the local development server:
```bash
pnpm dev
```

If you are modifying packages, make sure to build them:
```bash
pnpm build && pnpm run build:app
```

### Testing and Linting

Before submitting a Pull Request, make sure all tests and linting checks pass:

```bash
# Run tests
pnpm test

# Run linter and typechecker
pnpm run lint
pnpm run typecheck
```

## Pull Request Process

1. Create a new branch from `main`.
2. Make your changes in your feature branch.
3. Add or update tests as appropriate.
4. Ensure the test suite passes (`pnpm test`) and there are no linting errors (`pnpm run lint`).
5. Ensure your code follows the architecture guidelines and rules.
6. Open a Pull Request!

## Documentation

For a deeper dive into the architecture, configuration, and how to build plugins, please read the documentation in the `docs/` directory:

- [Development Guide](docs/development/development.md)
- [Golden Rules](docs/development/agent-golden-rules.md)
- [Architecture](docs/architecture/architecture.md)
- [Plugin Development](docs/plugins/plugins.md)
