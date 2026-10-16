# Delivery visibility repair: deterministic authored demo

Synthetic agent-authored policy, rules and paired forms. No provider call, human review, measured time saving or live-model success is represented. Actor context is agent-simulation and every revised result remains not-user-attested. This is a downstream developer repair/handoff demo after an interpretation already exists; it does not measure extraction, full policy review or end-to-end savings.

## Browser journey

1. At the repository root run `make run`, then open http://127.0.0.1:4177/?source=new . Paste [policy.txt](policy.txt), [form-defective.json](form-defective.json) and [drivers.txt](drivers.txt) into the corresponding new-input fields. Choose Validate locally. Do not choose live extraction.
2. Under Author rules independently, choose Agent simulation, then Author independent rules locally. Open the advanced JSON editor, paste [manual-rules.json](manual-rules.json), and Apply and validate draft.
3. Inspect all eight authored predicates and exact policy quotes. With no unresolved/unchecked slots, make the two explicit simulated review declarations and approve. Software validation does not establish policy truth or human identity.
4. Analyze approved rules. Expect two complete Boolean assignments and two discrepancies: delivery=false wrongly shows the note; delivery=true wrongly hides it.
5. Select and replay each witness in SurveyJS. Download a witness and the approved specification if wanted. Original replay stays bound to the defective original. A maintainer can verify an actual downloaded witness with `node src/cli.mjs replay /path/to/witness.json` from track_2b after installing the locked dependency.
6. In Check your form changes, paste [form-corrected.json](form-corrected.json), then recheck. Expect zero discrepancies in eight covered slots over two assignments, with no user attestation. Original approval never transfers to the replacement.
7. Download the revised result. A maintainer can fully recompute its verification using `node src/spec-cli.mjs verify-result /path/to/download.json` from track_2b after the locked dependency install. An actual browser download and inspection is still a separate gate.

Both forms have valid syntax. Native SurveyJS snapshots also reveal the inversion when a reader supplies the policy expectation. No superiority over policy-aware native tests is claimed. The small prepared usefulness trial has zero completed human sessions; no user benefit or population result is inferred from this demo.

## Docker-only mechanical demo

From root, `make demo` runs real SurveyJS and isolated workers without provider networking. It prints the summary; temporary output files disappear with the container. This command is separate from the interactive root `make run`.

## Maintainer reproduction retaining artifacts

With Node 24 and locked dependencies already installed, from track_2b run `node examples/delivery-review/reproduce.mjs artifacts/delivery-demo`. Use a new/empty output directory; overwriting is refused. It creates the specification, both verified witnesses, original analysis, revised result, summary and SHA-256 manifest. Run it into a second fresh directory to compare deterministic bytes. The fixed 2026-10-10 simulated review timestamp is not a real review event. Session/job IDs and operational duration are excluded from deterministic artifacts.

`node src/cli.mjs replay artifacts/delivery-demo/witness-1.json` and the corresponding witness-2 command verify both exported witness files through the original bounded-file parser. `node src/spec-cli.mjs verify-result artifacts/delivery-demo/revised-form-result.json` fully recomputes the result. `node src/recheck-handoff-cli.mjs artifacts/delivery-demo/revised-form-result.json` creates a readable verified brief beside it. Verification does not authenticate authorship. An altered artifact must fail visibly. [Provenance](provenance.json) retains the fixture's original derivation; the source fixture tests remain in the original private repository.

Attribution and approved license scope: [LICENSE_POLICY.md](../../../LICENSE_POLICY.md). Original source/evidence bytes and claims are preserved.
