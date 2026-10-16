# Keep reviewed rules in local native tests

This standalone package includes the native visibility exporter and its complete
fixed runtime closure. Native SurveyJS already tests visibility and requiredness.
This handoff reuses reviewed visibility predicates only; it makes no superiority,
authoring-time, human-validation or product-market-fit claim.

## Prepare the two different input files

Use the [saved r5 journey](../data/recordings/r5-sparse-candidate/README.md#open-the-saved-response)
or an approved supported supplied-input review. Choose **Download approved
specification**. Save the exact file locally as `approved-specification.json`.
A reviewed replay case is a different artifact. Saved specifications cannot reopen
a browser review.

Keep your raw revised SurveyJS form JSON separately as `revised-form.json`, using
your local form file or saving the revised-form editor text as UTF-8. **Download
revised-form result** saves an analysis envelope, not a form definition.

## Export and run

On a maintainer system with Node.js 24+ and this package's locked SurveyJS 3.1.2
already installed, run each command separately from `track_2b/`:

```sh
node src/native-regression-cli.mjs export ./approved-specification.json ./native-export
node src/native-regression-cli.mjs run ./native-export ./revised-form.json ./native-run
```

Substitute and quote your local paths. Both output directories must be fresh,
with existing nonsymlink parents. These commands make no provider/network request.
Initial dependency installation may need registry access. No dependency is installed
by these commands. Exported files contain private policy, form and review evidence;
creation does not authorize sharing or uploading them to hosted CI.

The export contains unchanged `approved-specification.json`, `native-suite.json`,
`native-sidecar.json` and a completion `receipt.json`. Read both sidecar omission
lists: `originallyUnchecked` stays unknown; `reviewedButUnexported` holds reviewed
requiredness rules. This exporter cannot preserve visible-only requiredness using
static native required checks, and refuses requiredness-only/zero-visibility input.
A native pass covers exported visibility assertions only, not requiredness,
unchecked properties or whole-form correctness. Only supported target-logic edits
are admitted; revised forms remain `not-user-attested`. Complete declared driver
assignments do not cover missing answers, transitions or submissions.

Run exits 0 for exported visibility passing, 1 for a visibility failure, or 2 for
invalid input/output/verification. A partial policy check can therefore exit 0.
Failed writes can leave an incomplete directory without a receipt; use a fresh
path after resolving the failure. Verify an existing export without running it:

```sh
node src/native-regression-cli.mjs verify ./native-export
```

## Verify a revised-form result or make a readable brief

Use the **Download revised-form result** envelope with these existing commands,
not as the raw form input above:

```sh
node src/spec-cli-r5.mjs verify-result ./my-recheck-result.json
node src/recheck-handoff-cli.mjs ./my-recheck-result.json
```

Verification recomputes the result. The brief command writes a new self-contained
`my-recheck-result.json.html` beside the unchanged JSON; keep both. Their consistency
hashes do not authenticate reviewers/providers or establish policy truth. Matching
source/dependency profiles are required; arbitrary, mixed and stale profiles fail.
The package supports ordinary, sparse-v5 and the closed genuine saved-r5 v2 profiles.

For the complete original FormRehearsal visibility/requiredness contract, recheck
that same raw form separately:

```sh
node src/spec-cli-r5.mjs recheck ./approved-specification.json ./revised-form.json > ./new-recheck-result.json
node src/spec-cli-r5.mjs verify-result ./new-recheck-result.json
```

Choose a new output filename: shell `>` can overwrite a file. Run verification
separately, not with `&&`. Recheck exits 0 for no discrepancies with all declared
slots covered, 1 for genuine discrepancies, 3 for no discrepancies in a partial
check, and 2 for malformed/unsupported input or failed computation. Exit 1 or 3 is
an analysis outcome, not a setup failure. In particular, r5's restored original
is partial-clean (3); its deliberate seeded discrepancy is 1. Verification exits
0 only after recomputation (otherwise 2). The readable-brief command exits 0 on
successful rendering even for discrepant/partial results, and 2 on rejection.
