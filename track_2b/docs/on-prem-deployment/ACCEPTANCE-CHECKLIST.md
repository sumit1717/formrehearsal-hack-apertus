# Proposed deployment acceptance checklist

All boxes are initially unchecked. This is a plan, not a verification receipt. A deployment claim requires the exact final source, actual operators and actual runtime evidence.

## Before starting

- [ ] Identify the administering organization and app/browser/inference host operators. Verify authority to run the hosts and process the selected non-sensitive synthetic input.
- [ ] Record the final app source/commit or immutable snapshot and image digest. Recheck candidate inventory after any integration. Keep v15 evidence source-specific.
- [ ] Record the complete checkpoint commit and file inventory, tokenizer/chat template, actual runtime version/source revision and platform-specific image digest. Confirm model-access terms were appropriately handled; do not infer acceptance from an available URL.
- [ ] Record GPU type/count/VRAM, RAM, disk, driver, CUDA, OS/container architecture, tensor parallelism, context and memory settings. Confirm sufficient measured memory headroom and prompt-plus-output context without advertising a universal minimum.
- [ ] Approve the exact inference destination, credential use, public CA trust if needed, internal port and bounded single request. Secret values stay outside the evidence.
- [ ] Record intended egress rules and data/log/download retention. Make sure prompt/output/debug logging is off and local administrative access is understood.

## App and transport

- [ ] From a clean selected source, build the app using the documented Docker path; distinguish cache use from cold build. Retain source/image identity and successful ordinary host-browser access at 127.0.0.1:4177.
- [ ] Verify loopback-only publication, nonroot user, resource limits and mature Docker health status. GET `/api/health` is liveness only.
- [ ] Observe the keyless authored workflow with live variables empty and attempts zero. This verifies the local route only.
- [ ] With the approved configuration, verify internal DNS, certificate chain/name and destination from the app container. No TLS bypass or plaintext fallback. Confirm configuration values through `/api/live/config` without exposing the key.
- [ ] Verify the inference service's model alias and actual weight/runtime inventory. `/v1/models` or a returned model string alone is not weight authentication.
- [ ] Confirm the service requires valid authorization on the intended completion route and network restrictions cover other routes. Do not send an unauthorized test request without the operator's approved test scope.

## One explicit end to end extraction

- [ ] Initiate the approved synthetic request once through the actual app UI. Retain original response/failure and exact prompt revision, source/policy/input identities, endpoint identity without credentials, declared cap and observed token counts/timing.
- [ ] Confirm exact returned model name, HTTP JSON response, one final assistant content, finish reason `stop`, consistent usage totals and bounded response bytes. A timeout, length finish, malformed JSON, invalid schema or abstention is reported honestly.
- [ ] Separately inspect quote grounding, predicate meaning and omitted rules. Record reviewer type truthfully. Do not call a structurally accepted answer semantically correct without the necessary assessment.
- [ ] Complete explicit review/approval, native check, supplied revision/recheck and verified exported-form/result path against the chosen source. Preserve unknown slots and original model output; do not label a manually supplied repair as generated.
- [ ] Observe zero new provider requests during deterministic comparison/recheck. In any separately authorized cancellation/reset test, confirm a cancelled result is not attached to the review and no new request is initiated automatically. The already-running provider call may continue until completion or transport timeout; its usage can still be recorded. Do not require or claim immediate provider termination or zero further resource use. Record failure boundaries separately; do not restart to conceal budget exhaustion.

## Deployment conclusion

- [ ] Record actual egress observations during startup, idle and extraction. Confirm no unintended remote fetch or telemetry. For an on-prem claim, document organizational administration of every component.
- [ ] If seeking an air-gap claim, additionally prove all runtime components and the browser/export/log environment operate with no external network connection while the internal inference path still works. `HF_HUB_OFFLINE` and `--network none` on the checker do not establish this.
- [ ] Preserve redacted logs and original input/output hashes; document cache/log/download locations, retention and cleanup. Stop owned services and verify resource cleanup without claiming model files/caches were erased.
- [ ] Update report wording only to the passed scope. Record failed/not-run checks, unresolved hardware/service details and model evaluation separately. No product-score, human-benefit, production-security or cost claim follows automatically.
