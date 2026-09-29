# GitHub Actions Official References

## Primary documentation

- **GitHub Actions Docs**: https://docs.github.com/en/actions
- **Workflow Syntax**: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions
- **Encrypted Secrets**: https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions
- **npm Trusted Publishing**: https://docs.npmjs.com/trusted-publishers

## Emergen application

CI pipelines should run on pull requests:

1. Install dependencies
2. Lint
3. Type check
4. Unit tests
5. Integration tests (where applicable)
6. Build

Production deployments should include staging validation, smoke tests, and health checks.
