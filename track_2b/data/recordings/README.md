# Selected real v3 recordings

These three files are a deliberate product demonstration, not a representative model evaluation dataset. All policies and fields are original synthetic examples; no private people's data is present.

- Garden Tool Shed: actual response from run 37154134064, attempt 1, 2026-10-03. It passed the historical author-reference comparison, which remains pending independent human review.
- Audio Cart: actual response from run 37158792936, attempt 1, 2026-10-03. Schema-valid; two predicates disagreed with the author reference. Its requiredness AND where the policy says OR is preserved.
- Pottery Cart: same two-policy run. Invalid wire schema, unscored. It remains blocked in the product; no syntax, quote-case or semantic correction is applied.

Each JSON preserves the original `rawFinalText` string byte-for-byte when UTF-8 encoded. Only an explicit allowlist of provenance was projected: requested/returned model, run/commit/date/case, v3/request/prompt/settings/plan hashes, source evidence file hashes, fixed request configuration and historical status/validity. Provider headers, credentials, reasoning and full envelopes are not bundled. Raw final text SHA-256 can be recomputed independently; source report/manifest/context hashes point to the durable experiment evidence, not files shipped in this directory.

All three requests used ordinary `swiss-ai/Apertus-v1.5-70B`, temperature 0, max_tokens 2048 and stream false. Exact hosted model revision and unspecified provider defaults remain unknown. The parser is the unchanged quote-extraction-v3 adapter; it only derives sequential IDs and unique exact UTF-16 quote positions. Exact occurrence does not establish entailment.

The local review interface may create an explicit edited draft for valid original recordings. It never overwrites these files, changes historical model correctness or creates independent human gold. A failed original recording cannot be repaired through this milestone.

Attribution and approved license scope: [LICENSE_POLICY.md](../../../LICENSE_POLICY.md). Original source/evidence bytes and claims are preserved.
