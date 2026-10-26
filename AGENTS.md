# Working in this repository

This is an unreleased Rust/Wasm browser-client prototype, version
`0.1.0-alpha.0`. Read `README.md`, `docs/architecture.md`, `docs/provenance.md`,
and `docs/verification.md` before changing behavior. Keep changes narrow and
preserve unrelated work. Describe implemented behavior and the exact evidence
supporting it.

## Source boundary

Keep official client source, assets, credentials, and raw captures outside Git
history and public reports. Commit original code and explicitly labelled
synthetic fixtures. External comparison inputs and evidence stay outside this
checkout. Follow `docs/provenance.md`; never import a reference to satisfy a test.

Run `node tools/check-repository.mjs` against the reviewed Git index and
`node tools/check-repository.mjs --history` before delivery. These guards inspect
Git blobs, so unstaged changes need separate inspection. Do not weaken the guard
to admit external artifacts. The only permitted vector asset is the original
`assets/logo.svg`; keep it free of scripts and external resources.

## Implementation and verification

Use Rust 1.99.0, Node.js 24, LF text, and Conventional Commits. Browser dependencies
are wasm32-only: wasm-bindgen 0.2.129 and web-sys 0.3.106. The build requires a
separately installed matching wasm-bindgen CLI, optionally selected by the
absolute `WASM_BINDGEN` path. Generated `dist/web` files stay ignored.

Follow `docs/verification.md` for npm installation and tests, Rust formatting,
all-target tests, doctests, Clippy, the web build, and real Wasm ABI smoke test.
Normal tests and CI require no external reference and must not connect to game
servers. State unrun checks and distinguish synthetic tests, local comparisons,
browser observations, and official-server acceptance. The live CLI is manual
only: it requires explicit authorization for one attempt and a fixed external
ledger. Never retry, replace, or bypass a consumed ledger.

Keep authoritative simulation in the separate `slither-sim` repository. Do not
modify that checkout or external comparison inputs as a side effect. CI runs on
pushes to `main`, pull requests, and `workflow_dispatch`. Release-plz is dormant;
follow `docs/releases.md` before changing delivery behavior.

## Delegation and independent review

Focused implementation agents are permitted within the task's scope unless the
user restricts delegation. Obtain independent review for consequential protocol,
security, source-boundary, or behavior changes. Use T3 Code's app-owned
`delegate_task` for child agents and `t3_thread_send` to continue the same
conversation. Discover the configured provider and model through
`orchestrator_capabilities`. For independent review, select **GPT 6.1 Sol** with
`reasoningEffort: high` explicitly in the target options. Do not substitute
another model or delegation route when unavailable; report the limitation and
continue independent work.

Give implementation agents clear file ownership. Keep reviewers read-only and
retain task IDs and terminal reports. The main agent evaluates findings against
the requirements and verification evidence.
