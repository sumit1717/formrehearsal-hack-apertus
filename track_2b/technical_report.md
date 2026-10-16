<!-- Team-named report revision: verified public repository and local demo link. The PDF is the authoritative layout. Release upload and public playback remain unverified; all substantive results are unchanged. -->

# FormRehearsal technical report

Track 2B · Online HackApertus 2026 · Team and sole entrant: Sumit Aswal

Public repository: [sumit1717/formrehearsal-hack-apertus](https://github.com/sumit1717/formrehearsal-hack-apertus) (template-created)

Decision-summary source 86cd4eb1 · Model evidence cutoff 15 October 2026 at 00:22 UTC

Demo: [local 118-second walkthrough](demo/FormRehearsal_Private_Evidence_Walkthrough.mp4); release upload and public playback verification pending.

## 1 Summary

FormRehearsal helps form developers decide what to change after a policy amendment and what to ask the policy owner. It compares separately approved interpretations with the original SurveyJS form, shows affected requests, and rechecks a supplied revision before handing over exact JSON. Useful Apertus interpretation and independent human benefit remain unestablished. [1–3]

### One amendment and two concrete edits

The synthetic example introduces a loading-dock exception: heavy courier deliveries need unloading assistance only without a dock. Handling contact depends on that assistance or courier delivery without a dock, so its visibility changes too. The original form still shows both questions to the dock-equipped request. Its complete neighbor differs only in dock availability. [2, 3]

| Complete request profile | Dock available | No dock |
| --- | --- | --- |
| Shared answers | Courier; heavy; urgent: No | Courier; heavy; urgent: No |
| Unloading assistance<br>old / new / original form | Shown / hidden / shown | Shown / shown / shown |
| Handling contact<br>old / new / original form | Shown / hidden / shown | Shown / shown / shown |
| Access-instructions visibility | Unknown | Unknown |

The authored replacement supplies these two visibility edits:

```text
unloading_assistance.visibleIf:
{delivery_method} = 'courier' and
{equipment_weight} = 'heavy' and {loading_dock} = false
handling_contact.visibleIf:
{delivery_method} = 'courier' and {loading_dock} = false
```

Accepted decision-summary browser evidence shows **2 of 16 combinations change**. Explicit recheck of the authored replacement finds zero discrepancies across five covered slots, with one unchecked, and enables the exact-form download. This is a **partial handoff**. Rules and replacement are source-authored; both approvals are agent-simulated. [2]

The owner must still decide which site-access conditions require special arrangements and whether the declared inputs suffice. The app grounds this question in the unresolved clause. All 16 combinations retain that unknown; 14 have no known change. Urgency does not affect the two known edits.

The first comparison view now presents the complete affected request, both changed questions and the unknown warning together. All fit without clipping at desktop and mobile width. Links lead to scenario details, owner questions and the revision editor. This is observed interface behavior on one synthetic example; human validation remains n = 0. [2]

## 2 Architecture

The browser holds the policy, original response, proposed rules, omissions and approval controls. A Node.js service serves local assets and bounded, volatile review sessions. Locked SurveyJS 3.1.2 executes native form behavior. Deterministic code enumerates complete declared assignments, compares behavior with approved predicates, and finds a smallest sufficient condition for each discrepancy. [2]

The general path is policy and supported schema → optional Apertus proposal → validation and explicit review → native comparison → supplied revision → fresh recheck. The equipment practice supplies authored drafts at the proposal step. Loading a draft does not approve it; old approval does not approve the amendment. Every omitted target/property slot needs a reviewed predicate or an explicit disposition that leaves it unchecked.

### Make the next decision inspectable

The decision summary presents one complete computed request, both old/new/original-form outcomes and unresolved scope at the point of decision. Its three keyboard-operable links open relevant local details without changing the approval or unchecked editor. Grounded owner questions retain the unresolved excerpt and approval identities. The request explorer selects an **already-computed original-form row** for any complete admitted assignment. It makes no new engine or provider call and does not inspect the revision editor. A nearby profile is unchanged only for the named comparisons.

The authored revision loader supplies replacement bytes without approval or analysis. A separate recheck evaluates those bytes against the new approval and enables the exact-form download. Editing, even followed by an exact revert, retires that handoff until another explicit check. The original comparison remains bound to the original form. A separate native-test export can reuse reviewed visibility assertions; requiredness and originally unchecked properties remain outside that export’s passing scope. [2, 3]

Admission is deliberately narrow: one page, one to six independent Boolean or finite string-choice drivers, and at most 256 complete assignments. Compatible revisions may change supported target visibility and requiredness logic. Native requiredness is compared only while a target is visible. A single computation slot, bounded inputs and output, a 60-second deadline and stale-result rejection constrain deterministic work.

### Target architecture and dependencies

The proposed on-premise arrangement places the browser and app on an organization-administered workstation and Apertus inference on its internally administered GPU host. The app remains loopback-only; its server calls a fixed, authenticated HTTPS inference endpoint. Build time needs the pinned Node/Alpine image and locked npm dependency. Runtime needs local app assets and, for extraction, the separately provisioned inference service. No weights are bundled. [1, 4]

The operator guide specifies host ownership, pinned images and weights, hardware, trusted TLS, storage and log retention, restricted egress and an end-to-end acceptance journey. This plan is **unexecuted**. The app is a trusted single-user prototype without multi-user authentication. A disconnected checker does not establish air-gapped inference; a Swiss endpoint alone does not establish whole-system Swiss residency.

## 3 Use of Apertus

Apertus’s intended contribution is to turn policy prose into evidence-linked candidate predicates that a reviewer can accept, reject or leave unresolved. Native execution then answers a different question: does the form implement that approved interpretation over the declared domain? The equipment example isolates this downstream workflow; its interacting-clause expansion and replacement form were authored, not generated by Apertus.

Historical r5 requested **swiss-ai/Apertus-v1.5-70B** with extraction-v5. For “Always show route_check,” its retained response proposed one visibility rule and omitted three slots. The saved journey has agent-simulated approval and a separately authored defect. This selected, exposed example establishes neither broad quality nor human review. Provider origin remains host-declared; hosted weights and hardware are unverified. [5]

The optional live bridge supports ordinary Apertus v1.5 8B or 70B through an explicitly configured HTTPS service. The application default remains extraction-v3; extraction-v5 is opt-in. Explicit initiation, single-flight execution, bounded tokens, bytes and time, and no automatic repair or retry constrain requests. No fine-tuning is claimed. These controls are not a currency cap or proof of provider enforcement.

Explicit extraction sends the policy, title and projected finite field schema to that endpoint. Complete SurveyJS JSON and form expressions are excluded, although selected text can still be sensitive. Review, comparison and recheck make no inference request. New model-only experiments remain separate from the application’s prompt defaults and from the authored demonstration. [2, 4]

**New evidence-before-AST result.** Model-only run 38658653414 requested Apertus v1.5 70B on exposed case D01. Its unchanged 904-byte response quoted evidence for four slots but marked all four rule slots unstated. Frozen validation rejected c_unstated_with_evidence:s001 before projection, compilation or scoring; no executable predicate or scorer credit was obtained. Reference cells remained ineligible and unscored. The sign-off excerpts also omitted the waiver/hidden-optional continuation. Evidence occurrence alone did not establish complete policy coverage or a valid rule interpretation. [7]

The ordinary-stop envelope reports 1,511 prompt plus 262 completion tokens; transport took 5.767 seconds. These are one-call counters, not billed cost or model-quality measures. D01’s numeric driver remains outside native-product admission. Dynamic receipts were recovered from the same authenticated log; separate private capture-supervision and cleanup originals were unavailable. [7]

## 4 Data

Inputs are original synthetic policy/form families and retained model responses. Development cases have been exposed; historical holdout labels no longer imply unseen evaluation. Neither AI-authored cases nor source-authored approvals are human semantic gold. Independent human validation is **n = 0**; no human-subject dataset, measured task benefit, adoption or product-market fit is claimed.

Bulk private captures are excluded. Nine exact historical r5 files remain necessary for the closed saved-response adapter. DATA_LICENSES.json licenses the listed synthetic and selected response data under CDLA-Permissive-2.0, only to the extent of contributor rights; the retained parser is Apache-2.0 code. No exclusive AI-output ownership is asserted. Final packaging needs a fresh contents and 100 MB data-limit check. [1, 2]

Companion media: an unchanged, silent **118-second edited still-image walkthrough** shows this accepted decision-summary example. Genuine same-run desktop-width captures and labelled editorial cards preserve the unknown-slot, partial-check and agent-simulation limits. Independent review verified source composition, full decode and all shot layouts. The depicted journey establishes neither model quality nor human benefit; it is not continuous interaction footage. [6]

## 5 Evaluation

Implementation, policy meaning and human benefit need separate evidence; passing one does not establish the others.

### Observed amendment workflow

The accepted decision-summary source was checked on one authored fixture at 1440 × 900 and 390 × 844. Both showed the complete decision summary in the untouched first viewport and completed agent-simulated reviews, owner guidance, authored revision loading, partial recheck, exact-byte download and invalidation. Five slots were covered over 16 assignments; access-instructions visibility remained unchecked. The replacement was not-user-attested and provider attempts were zero. Two viewports are not two users or two policies. [2]

The explorer displayed all 16 cached rows and six slots per row at each width without another comparison or revision check. Native-name controls passed; downloaded form bytes matched the checked revision. Owned processes/resources were cleaned up. This bounded result establishes no current shipping or full-aggregate pass. [2]

### Retained model diagnostic

Run 38226380685 compared three Apertus v1.5 70B recipes on four exposed cases: two supported and two abstention cases, at temperature 0. A used plain V8a/1,024 tokens; B used the same messages/2,048; C combined fixed slots, passage IDs and schema/2,048. Historical arm C differs from the separate evidence-before-AST candidate. [7]

| Per four-case arm | A | B | C |
| --- | --- | --- | --- |
| Structural product acceptance | 1/4 | 1/4 | 4/4 |
| Deterministic diagnostic failures | 3 | 3 | 2 |
| Cases pending human adjudication | 1 | 1 | 2 |
| Supported cells evaluated / planned | 0/160 | 0/160 | 0/160 |

C marked every slot unstated, including supported cases requiring rules. Those two failed status checks before Boolean evaluation; the abstention cases still need human grounding review. The 160-cell denominator is 16 × 4 + 24 × 4. A/B retained quote-grounding, malformed-JSON and schema failures. All 14 requests, including two unscored capability probes, returned HTTP 200; transport success did not establish semantic success. In this historical diagnostic, strict automatic passes remain zero while adjudication is pending, not because humans judged every case incorrect.

The separate evidence-before-AST failure in Section 3 receives no predicate credit and does not change this historical table.

### Value cost and scale

The next fair comparison is an equivalently informed native SurveyJS workflow, which already supports conditional editing and preview. Measure amendment mistakes, missed unknowns, comprehension, help and full time including review; report a worse outcome if observed. There are no measured savings. Scoped comparison and recheck avoid inference calls, but enumeration grows with the product of driver domains and stops at 256. No throughput or operating-cost study is available. [8]

## 6 Limitations

Correctness is conditional on approved meaning and the declared domain. The checker does not prove policy truth, validate target answers or establish whole-form correctness. Numeric, dependent and unanswered drivers, multipage transitions, dynamic panels and arbitrary expressions remain outside admission. A minimal witness minimizes constrained answers for one rule and direction, not a person’s entire workflow; equally small witnesses can exist.

Unknown remains unknown even when the other policy has a rule. A changed required predicate can be reported while the target is hidden, but native requiredness comparison is skipped there. Predicate deltas therefore do not prove submission behavior. The equipment case’s cross-target meaning was explicitly expanded by its authors; automatic dependency interpretation is unestablished.

Current admission rejects independent-driver names that exactly collide with length, self or the ten built-in variable names in pinned SurveyJS 3.1.2. It preserves the input strings and accepts other context-like names and target-only names within the admitted forms. Both viewport journeys exercised 12 rejected collisions, four accepted context spellings, a target-only name and numeric rejection. Other accepted spellings retain source/pure-test evidence only. This narrow guard does not establish general native-expression support. [2]

Historical failures remain in the evidence record. No full aggregate pass, independent usability study, accessibility certification, exhaustive lifecycle/race coverage, production-security assessment or qualifying app-plus-inference deployment is established. Mobile-width evidence is not a physical touch-device result. Live summary-link expiry activation and active-link retention through refresh remain pure-test-only. Review effort may exceed the benefit.

## 7 Reproducibility

The evaluated decision-summary source has 133 files and external inventory `86cd4eb1688c943687690f38b4f13223de8ddf266efc737a4051ad04f9a25f3e`. It is distinct from the earlier ce3e0807 source despite the same file count. This digest is not a published commit. Its manifest separately hashes 132 files because it excludes itself. The exact source, harness, environment and original evidence must travel together; hashes bind bytes, not semantic truth or reviewer/provider identity. [2]

Documented root launch with Docker, Make and a browser; no key is required for authored practice:

```text
LLM_NAME= LLM_BASE_URL= LLM_API_KEY= make run
```

Open http://127.0.0.1:4177 after startup. Cold builds need image/package downloads. On the earlier v15 source, root and track entry points built from cache and served nine exact assets through container-internal loopback under approved sandbox overrides. This did not establish ordinary host-port browser reachability, cold builds, stock-default settings or matured Docker health status. [3]

Static byte check of the exact exported release tree, without .git, dependencies or generated outputs, using Python 3:

```text
python3 checks/check_public_source_v1.py .
```

The public-source checker rejects extra or missing files/directories, symlinks and byte/hash mismatches; it launches no product code. A pass establishes neither runtime readiness nor distributor identity. The historical private checker is preserved separately. Retain both approved specifications, original comparison, supplied form, fresh result and exact downloaded JSON. Unknown scope and stale-download invalidation are part of reproduction, not optional footnotes.

## 8 Next steps

With the bounded decision-summary journey accepted, the next priority is useful Apertus interpretation on independently adjudicated new policies. Retain original outputs, abstentions and preparation failures. Observe consenting developers against the fair native baseline before claiming task benefit. Over another month, prioritize measured review burden, broader lifecycle/accessibility cases and a verified organization-administered app-plus-inference deployment.

The public repository was created from HackApertus/project-template. Before submission, complete source/media integration and verify public judge access. Team, scoped project licenses and event terms are approved. The deadline is 16 October 2026 at 12:00 CEST / 10:00 UTC. Final artifact review, mandatory-checklist completion and the official portal receipt remain outstanding. The development repository remains private. [1, 9]

### License and availability

Original report content © 2026 Sumit Aswal, CC-BY-4.0; outline adapted from the official CC-BY-4.0 scaffold. Third-party notices remain. LICENSE_POLICY.md scopes Apache-2.0 code, CC-BY-4.0 docs/media and listed CDLA-Permissive-2.0 data. Event terms are separate. Private evidence identifiers are provenance, not public download links.

## References

Six total pages include references; the official README permits six pages excluding references. All eight technical sections and accepted evidence boundaries are retained.

[1] [Official Track 2B requirements](https://github.com/HackApertus/project-template/blob/main/track_2b/README.md) and [report template](https://github.com/HackApertus/project-template/blob/main/track_2b/technical_report.md), checked 15 October 2026. Working Apertus prototype, root Docker launcher, public template repository, two-minute video and mandatory deployment architecture.

[2] Decision-summary source 86cd4eb1… and independent check14 review f9143d30…, 15 October 2026; original archive e00d9e3c…. Both bounded viewport journeys passed. Earlier ce3e0807 evidence belongs to a different source. Full pins are retained separately; no shipping pass is inferred.

[3] Retained v15 source-specific browser review and separate shipping addendum, 14 October 2026. Source inventory 8b13f64e…; browser evidence bd215a7d…; shipping archive 414cae57…. These are historical private evidence identifiers, not current-source acceptance.

[4] Current on-premise operator guide, configuration example and acceptance checklist. Proposed deployment only; the guide explicitly retains its 127-file pre-documentation source binding within the later package.

[5] [Historical r5 capture](https://github.com/sumit1717/doru-formrehearsal/actions/runs/38087160778), run 38087160778, commit 4986838b…; [saved-response interaction](https://github.com/sumit1717/doru-formrehearsal/actions/runs/38230122395), run 38230122395. Private access; original response and omissions remain preserved.

[6] Check14 118-second still-image walkthrough, video 46b6b61c… and independent media review eeea77ec…, 15 October 2026. Source-bound captures, editorial labels, captions and decode evidence are retained. Earlier ce3e0807 media remain historical.

[7] [Historical schema-v2 diagnostic](https://github.com/sumit1717/doru-formrehearsal/actions/runs/38226380685), run 38226380685. [New evidence-before-AST run](https://github.com/sumit1717/doru-formrehearsal/actions/runs/38658653414), 38658653414, source f7383e04…; original content 9b95c72a…, custody review a203f63e… and semantic rejection 919abdb8…. Outputs remain unrepaired; historical credit is unchanged.

[8] SurveyJS [conditional editing and Preview](https://surveyjs.io/survey-creator/documentation/end-user-guide/form-display-logic), [runtime-variable presets](https://surveyjs.io/stay-updated/release-notes/v3.1.1) and [JSON linting and data verification](https://surveyjs.io/stay-updated/release-notes/v3.1.2). Native capability baseline; no measured superiority.

[9] [Organizer event page](https://hackapertus.ch/online-hack), [submission portal](https://hackapertus.ch/online-hack/submissions) and [terms](https://hackapertus.ch/terms-and-conditions). Final deadline, access and submission checks remain separate.
