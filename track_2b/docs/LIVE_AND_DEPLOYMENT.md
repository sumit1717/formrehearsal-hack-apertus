# Optional live Apertus and deployment limits

The default app and named delivery demo are keyless. Only explicit extraction crosses the provider boundary. No current real-provider run is claimed by this stage.

At process startup an operator supplies exactly:

- LLM_NAME: swiss-ai/Apertus-v1.5-8B or swiss-ai/Apertus-v1.5-70B
- LLM_BASE_URL: a trusted authenticated HTTPS base without userinfo, query, fragment or an appended /chat/completions path. The documented CSCS example is https://api.inference.cscs.ch/v1 .
- LLM_API_KEY: the operator's existing authorized credential for that exact destination, supplied through the runtime environment/secret manager. Do not paste it into a command, chat, source, image, screenshot or browser.

Optional `LLM_EXTRACTION_PROMPT_REVISION` uses the existing startup selector: `extraction-v3` remains the default, `extraction-v4` remains available, and `extraction-v5` is an experimental opt-in. V5 system SHA-256 is `55d67b7b6540c37287f90d94041c8cc462f8a5b428f776c8fef39da3df04a444`. Live settings and the source summary disclose the selected revision/hash. One exposed development case matching its expected rule is not reliability, generalization or default-replacement evidence. Every omitted slot still needs an explicit disposition or rule before approval; disposed slots stay unchecked.

The Makefile forwards only variable names at runtime; there are no credential build arguments or bundled keys. If supplied, LLM_MODE must be ordinary. Missing/invalid settings leave live extraction disabled and keyless mode available. Configuration validation is not endpoint reachability, trusted TLS, hosted-weight identity or successful inference. Plain HTTP localhost is intentionally rejected. The container's localhost is the container itself.

Only after explicit extraction does the server send the fixed prompt plus policy, title and projected finite field IDs, labels, roles, kinds and domains. It does not send complete SurveyJS JSON, form expressions, raw driver-list text, review declarations or witness answers. This is minimization, not anonymization. Titles, choices and policies may still contain sensitive text; use non-sensitive examples. Review/check/replay remain local. Defaults: three attempts per process, one in flight, 2,048 output tokens/attempt, 6,144 reserved output tokens, 30-second deadline and bounded byte/token counters. No automatic retry, repair or fallback. These are local resource limits, not a currency cap; cancellation may still be billed and restart resets budgets.

Serve only one trusted local user over loopback. Host/same-origin checks are not user authentication; do not expose through a shared/public reverse proxy. Inputs/review state and provider output are volatile in browser/server memory; exports can contain complete input/output and review details. Browser sessionStorage holds recovery IDs, not policy/form text. Expiry is not secure erasure. Host logs, downloads, swap, backups and administrators remain outside this application's guarantee.

## Designed deployment options, not deployed evidence

A complete on-premise target needs an organization-administered app host and Apertus inference host, reachable internal HTTPS with trusted certificates and existing bearer auth, exact supported alias, pinned inference image/model revision, actual hardware and an observed end-to-end journey. A Swiss-host-plus-CSCS arrangement additionally needs a verified Swiss-operated app/browser/export/log host under Swiss jurisdiction and residency. CSCS inference evidence alone does not establish the application's host, permission to host there or whole-system residency.

No qualifying app host, GPU allocation, actual TLS/network path, exact inference image/weights or account-specific retention arrangement is established here. Local app plus CSCS is a hybrid, not a complete sovereign deployment pass. Ordinary `make run` retains Docker networking for host browser reachability; `make demo` (which supplies `--network none`) is only an authored checker control. It is not air-gapped Apertus inference. An air gap additionally requires pre-staged verified app/inference images, weights, drivers and dependencies, internal trusted TLS/name resolution, a working browser path and verified absence of external runtime networking.

[Remaining exact checks](../../HOSTED_GATES.md). Current source is built with an Apertus bridge, but this staging exercise makes zero live calls and never substitutes authored rules for failed model output.

V5 specifications use the versioned `src/spec-cli-v5.mjs` for local recheck/verify-result. Original `src/spec-cli.mjs` and `src/judge-live.mjs` stay byte-exact; the current server uses the separately versioned v5-capable live bridge, with v3 still the default.

The separate closed historical r5 source uses `src/spec-cli-r5.mjs` for portable local recheck/verification and routes old specifications to the existing adapters. Its exact retained evidence, original eight-state partial-clean check, newly authored revision and restoration are documented in the [saved-journey guide](../data/recordings/r5-sparse-candidate/README.md#open-the-saved-response). Loading it is keyless local reading, not live inference; historical host-declared provenance is not independently authenticated, and current review does not alter historical adjudication.
