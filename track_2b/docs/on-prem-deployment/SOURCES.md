# Deployment documentation sources

Read 14 October 2026. Public documents can change. The inspected code below is pinned where possible; an eventual runtime image must be matched to its own source/version rather than assumed to match these links.

## Official primary sources

1. [Hack Apertus Track 2B](https://github.com/HackApertus/project-template/blob/main/track_2b/README.md): mandatory on-premise, air-gapped or sovereign Swiss cloud deployability.
2. [Official Apertus 1.5 8B model card](https://huggingface.co/swiss-ai/Apertus-v1.5-8B): model-specific serving instructions, modified Swiss AI runtime, architecture-specific images, hardware-dependent sizing and model access conditions. No source-derived minimum VRAM is asserted here.
3. [Swiss AI runtime image source](https://github.com/swiss-ai/model-launch/blob/main/images/vllm_apertus_1.5_release/Dockerfile) and [official package registry](https://github.com/swiss-ai/model-launch/pkgs/container/vllm_apertus_1.5_release): selection sources, not a tested image pin. Mutable tags are not immutable evidence.
4. [Pinned Swiss AI vLLM API server](https://github.com/swiss-ai/vllm/blob/a601a9d998ddeb488f0c17e8512874b116aa7658/vllm/entrypoints/openai/api_server.py): environment-key authentication, served names, TLS wiring and request/output logging controls. GitHub content blob: `59c7ee84caefd52643beb33d2a6453e1ef2aa60b`.
5. [Pinned CLI configuration](https://github.com/swiss-ai/vllm/blob/a601a9d998ddeb488f0c17e8512874b116aa7658/vllm/entrypoints/openai/cli_args.py): TLS files, default chat-template kwargs and access-log flags. Blob: `8dbb69943903895278213eb61eb03f85b73ee55c`.
6. [Pinned authentication middleware](https://github.com/swiss-ai/vllm/blob/a601a9d998ddeb488f0c17e8512874b116aa7658/vllm/entrypoints/serve/utils/server_utils.py): guarded prefixes `/v1`, `/v2`, `/inference`; do not treat the API key as universal route protection. Blob: `c6520658090530e597b51c369a201647888169ac`.
7. [Pinned vLLM environment definitions](https://github.com/swiss-ai/vllm/blob/a601a9d998ddeb488f0c17e8512874b116aa7658/vllm/envs.py): `VLLM_API_KEY`, usage-statistics and do-not-track switches. Blob: `9305bb9cbe7d75b18e0ff3f0dbc3c38e76b9d661`.
8. [Pinned vLLM model configuration](https://github.com/swiss-ai/vllm/blob/a601a9d998ddeb488f0c17e8512874b116aa7658/vllm/config/model.py): model path and served-model naming. Blob: `6e3fef0dcca7d931c6263a5a242d8b4eb314ed86`.
9. [Node 24.21 CLI documentation](https://github.com/nodejs/node/blob/v24.21.0/doc/api/cli.md#node_extra_ca_certsfile): startup-only process trust extension from a PEM file.
10. [Hugging Face Hub environment variables](https://huggingface.co/docs/huggingface_hub/en/package_reference/environment_variables): offline cache behavior and telemetry control. These are component controls, not network-isolation evidence.
11. [vLLM security guidance](https://docs.vllm.ai/en/latest/usage/security/): runtime security boundaries; current upstream guidance must not silently stand in for the chosen image's behavior.

## Exact local application basis

All paths below are relative to the source root recorded in SOURCE-BINDING.json. That file records every candidate file's byte hash and mode; no local code was imported or executed for this documentation.

- `track_2b/Makefile:1–16`: loopback publication, runtime limits, environment forwarding, Docker options and disconnected demo distinction.
- `track_2b/Dockerfile:1–18`: pinned base, locked production install, local assets, nonroot user, container binding and liveness probe.
- `track_2b/src/server.mjs:29–40,81–96` and final startup block: loopback Host, HTTP same-origin, live-config route, explicit extraction and `process.env` startup.
- `track_2b/src/judge-live-v5.mjs:8–41,63–118`: exact models/mode, authenticated HTTPS, finite limits, one active call, required usage, explicit request initiation and failure handling.
- `track_2b/src/model-runner.mjs:16–25,86–111,175–240`: base URL construction, strict response boundary, bearer transport, redirect rejection and no retry.
- `track_2b/src/judge-contract-v5.mjs:10–30,39–45`: model/prompt allowlists and text-only chat request.
- `track_2b/src/apertus.mjs:62–72`: projected policy/schema input.
- `track_2b/docs/LIVE_AND_DEPLOYMENT.md`: existing deployment and data-retention qualifications, preserved unchanged.

## Evidence scope retained

V15 source inventory: `8b13f64e157ab437abc1f850c63a7de12e9a804af8a69a1eb3f8779970742ea4` (125 files). Preserved v1 guide basis: `f123b87eeee4c4d4f0d26b4a65ae0fc6d358262de73671cb5069c26c708694a1` (127 files). Current v2 guide basis: `9fc907c7511f9507ebecfdd81394fa71d4c9fcc01c873f53884e201a0f574e84` (127 files), the explorer-integrated candidate. It changes the policy-impact presentation, stylesheet and current manifest from the v1 basis; all 11 deployment-related files listed in SOURCE-BINDING.json remain byte-identical. This documentation adds no native/app/browser/provider/shipping execution evidence.

The v15 independent shipping addendum covers cached startup and internal HTTP, under approved overrides, for the former source only. It does not close the final deployment checklist. No model output or test pass was produced by these documents.
