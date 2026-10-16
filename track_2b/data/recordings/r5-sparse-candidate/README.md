# Closed historical r5 evidence pack

These are exact copied bytes from the verified private GitHub run [38087160778, attempt 1](https://github.com/sumit1717/doru-formrehearsal/actions/runs/38087160778), source commit `4986838beeddafbc7cb92c77511fa397e7b01192`, tree `cf1c81d1b4194fb8df0cc108109ea2a2df46014f`. Artifact `11681908673` has ZIP SHA-256 `812e0b09748e944092094cf98e1dae4dc717b0582df8e6111e9559c1c33c87f9`.

The selected batch is `formrehearsal-development-20261009-d1-C-2B-pair-r5`; the only admitted case is `D-2B-CANDIDATE-r5`. The request, envelope, original assistant content, receipt, historical derived record, and historical derivation provenance were copied from that artifact. Original input, prompt and historical parser source were copied from the frozen matching source packet. Exact file hashes are closed constants in `src/historical-recording-r5.mjs`.

For the runtime's text-only packaging rule, the original UTF-8 `original-assistant-content.bin` and `original-envelope.bin` files are stored here with `.txt` and `.json` extensions. Their bytes and hashes are unchanged; historical receipt paths retain their original names.

- `app-input.json`: exact original raw policy, form and driver strings. Its route_check question has no visibility condition and is already clean against the one retained predicate.
- `request.json`, `original-envelope.json`, `original-assistant-content.txt`: exact historical bytes, never regenerated through the current live adapter.
- `capture-receipt.json`: host-declared capture, not independently authenticated provider origin.
- `derived-record.json`, `derived-provenance.json`: historical host derivations. They remain unadjudicated, answer-ineligible and without human gold.
- `extraction-v5.txt`: exact prompt file; historical system text uses its trimmed bytes.
- `plain_response_stop68_v3.py`: exact historical parser source, retained as evidence. The current app does not execute Python or claim to reproduce that historical runtime. Its closed JavaScript source adapter separately validates the exact retained envelope, including stop reason 68.

The raw assistant content contains one predicate: `Always show route_check.` The other three target/property slots remain unchecked. The selected candidate does not erase the invalid control or earlier failures, and does not establish accuracy, generalization, usefulness, formal C/S credit or AI superiority over authored fixtures. The invalid control response is retained separately in the private development source at `tests/fixtures/r5/invalid-control-original.bin` for rejection regression; that path is not included in this public package. Full original failed evidence remains in the preserved evaluation evidence.

Loading or verifying this pack performs only local reads. It makes no provider request, reads no credentials, fabricates no live UUID or endpoint, and does not alter historical adjudication. Current local admission, quote normalization, review revision and recheck execution are separately identified in new artifacts.

## Open the saved response

After the [root launch](../../../../README.md#judge-start), choose **Inspect the saved Apertus response** in the app, or open http://127.0.0.1:4177/?mode=review&recording=r5-sparse-candidate. This loads the preserved response locally and makes no provider call.

1. Select the reviewer context truthfully, then choose **Start fresh review with this context** to activate it. An automated rehearsal must use **Agent simulation**. Inspect the single proposed rule, its quote and all three omitted checks. Decide explicitly how to handle each omission; unresolved checks stay unchecked.
2. If you accept the interpretation, give both review declarations, approve the partial check and analyze the original eight assignments. If you disagree, leave without approval or choose **Your policy and form** to author a separate interpretation. Validation is not agreement.
3. Use **Download approved specification** to retain the exact approved rules and unknown scope. This is the input needed by the [native-test handoff](../../../docs/NATIVE_REGRESSION_HANDOFF.md).
4. For the revise/restore exercise, use **Copy newly authored seeded revision**, then explicitly **Recheck revised form**. Choose **Restore exact historical original**, then recheck separately. The seeded defect is authored; it was not the historical model input. The three omissions remain unchecked throughout.

These are instructions for the existing UI, not a new execution result. Approval and a passing partial check do not create human gold, authenticate the provider or establish whole-form correctness.

Attribution and approved license scope: [LICENSE_POLICY.md](../../../../LICENSE_POLICY.md). Original source/evidence bytes and claims are preserved.
