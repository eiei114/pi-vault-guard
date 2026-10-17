# Human-owned npm publish handoff

The canonical `main` manifest is already at `0.2.0`. Because the updated README and changelog are included in the npm package, this PR prepares the patch release candidate `pi-vault-guard@0.2.1`. It does not publish, create a release/tag, or dispatch a workflow. Package publication remains a maintainer-only protected action.

## Required human action

After reviewing and merging the PR, a maintainer should:

1. On `main`, confirm `package.json` is exactly `0.2.1`, review the `0.2.1` changelog entry and the package contents, and verify that tag `v0.2.1` has not already been released.
2. Confirm the release candidate checks on `main` pass: `npm run ci`, `npm pack --dry-run`, and `npm publish --dry-run`.
3. In GitHub Actions, run **Manual Release** on `main`, set `version` to `0.2.1`, and explicitly set `confirm_release` to `true`. That workflow creates `v0.2.1` and a GitHub release, then dispatches the publish workflow for that tag. The publish workflow performs the actual `npm publish --access public` using npm Trusted Publishing.
4. Verify the public package only after the maintainer-owned release/publish workflow completes.

The `confirm_release` dispatch is the human authorization for a public, externally visible and effectively irreversible release. Do not create the tag, publish the GitHub release, or dispatch either workflow until the PR and package contents have been reviewed. If a manual npm operation prompts for an OTP, only the maintainer may enter it; this agent must not request, handle, store, or transmit OTP credentials.

## Checks executed for this preparation

The implementation agent may run `npm run ci`, `npm pack --dry-run`, and `npm publish --dry-run` locally. The last two commands are simulations only. No `npm publish`, tag creation, GitHub release, or workflow dispatch is authorized by this handoff.
