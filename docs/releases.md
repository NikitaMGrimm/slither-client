# Releases

The crate is `0.1.0-alpha.0`, unreleased, with `publish = false`. There is no
extension-store package, GitHub release, or registry publication workflow.

`release-plz.toml` is deliberately dormant: `release = false` disables version
updates as well as release processing. Ordinary pushes run checks only.

Before enabling release preparation:

1. Complete a documented playable milestone and its compatibility checks.
2. Verify every packaged file is authored here or has recorded permission and
   attribution. Keep official-client code, images, and raw captures external.
3. Choose which artifact is being versioned: crate API, browser bundle, or
   extension package. Keep server protocol identifiers separate.
4. Pin and validate a release-plz version. For a package that stays off crates.io,
   consider `git_only = true`; it derives the baseline from Git tags and treats
   a missing tag as the initial release.
5. Enable release-PR preparation first, with checks and maintainer review. Treat
   Git tags, GitHub release assets, registry publishing, and extension-store
   uploads as separate delivery actions.

No secrets, trusted publishers, schedules, or auto-merge rules are configured.
See the [release-plz configuration reference](https://release-plz.dev/docs/config).
