# FormRehearsal

LOCAL PUBLIC RELEASE CANDIDATE. Sumit Aswal has approved this bounded release scope, attribution and licenses. The public repository and template origin are verified; release-file upload, public PDF/video access verification and the official submission receipt remain outstanding. Local preparation alone is not publication or submission.

FormRehearsal helps form developers review a policy amendment, compare explicitly reviewed interpretations with a SurveyJS form, inspect affected requests, and recheck a supplied revision before downloading the exact checked JSON. It is a bounded single-user prototype.

## Judge start

- [Read the team report](track_2b/Sumit_Aswal_Report.pdf) · [matching Markdown](track_2b/technical_report.md)
- [Watch the 118-second walkthrough](track_2b/demo/README.md), an edited still-image demonstration with captions
- [Inspect the proposed on-premise architecture](track_2b/docs/on-prem-deployment/README.md), which remains unexecuted

To try the authored example, use Docker, Make and a browser. Run from the repository root:

```sh
LLM_NAME= LLM_BASE_URL= LLM_API_KEY= make run
```

Open http://127.0.0.1:4177 after startup and choose **Try the equipment policy amendment**. Follow the separate old-policy and amendment reviews, then compare the original form and explicitly recheck the supplied authored revision. Look for the two visibility edits and the unresolved access-instructions question. Loading a draft or revision does not approve it or run a check.

The authored practice requires no key and makes no provider request. For the distinct model evidence, choose **Inspect the saved Apertus response**; the [saved-response guide](track_2b/data/recordings/r5-sparse-candidate/README.md#open-the-saved-response) explains its one retained rule and three unchecked slots. Neither route is a new live-model test.

Cold builds need the pinned image and locked npm dependency. Root `make run` delegates to the unchanged track launcher. Current shipping verification remains unexecuted in this candidate's source evidence.

## Submission materials

- Track: 2B, Own Project; event: Online HackApertus 2026
- Team: Sumit Aswal; sole entrant and attribution: Sumit Aswal; GitHub: sumit1717
- Public repository: [sumit1717/formrehearsal-hack-apertus](https://github.com/sumit1717/formrehearsal-hack-apertus); verified public template-derived repository. Public release-file access is checked separately.
- Final report: `track_2b/Sumit_Aswal_Report.pdf`; its public download URL remains unverified
- Demo: the 118-second walkthrough linked above; public playback URL remains unverified
- Historical source material remains available through [current evidence](CURRENT_EVIDENCE.md#frozen-report-and-media), separately from the final submission report

The public repository was created from [the official template](https://github.com/HackApertus/project-template) using its template flow. Its initial commit is [b59520fe9ad216fbb891fa695369851220458ff1](https://github.com/sumit1717/formrehearsal-hack-apertus/commit/b59520fe9ad216fbb891fa695369851220458ff1), with tree `2d5642aa258364395f3ebd3f1e120912efd2958f`, matching template source commit `09f8e9e2b588db3325869b23c6d5132f5c3756f7`. This bounded release retains `track_2b/` and removes unused template tracks while preserving that starter history. The earlier private development repository was separately created and later aligned with the template. No claim is made that its development history began from the template.

## Evidence and limits

Check 14 observed one authored synthetic equipment journey at desktop 1440×900 and mobile width 390×844. This was an automated walkthrough with simulated approvals, zero human participants and no provider calls. Two of sixteen combinations change; all sixteen retain an unknown access-instructions slot. Rechecking the supplied revision found zero discrepancies across five covered slots, with one unchecked. That is a partial handoff, not whole-form correctness or independent human validation.

Selected historical Apertus responses remain available with their failures. The separate model-only run 8 was rejected before projection, compilation or scoring; its cells are ineligible and unscored. Historical supported cells evaluated/planned remain 0/160 per arm. Useful Apertus interpretation, human benefit, full aggregate regression and qualifying app-plus-inference deployment remain unestablished. See [current evidence](CURRENT_EVIDENCE.md) and [remaining gates](HOSTED_GATES.md).

## Licenses and data

Original code/build configuration is licensed under Apache-2.0, original documentation/prompts/report/walkthrough under CC-BY-4.0, and listed synthetic and selected model-response data under CDLA-Permissive-2.0, to the extent of contributor rights. [License scope](LICENSE_POLICY.md), [attribution](NOTICE), [item and instance data metadata](DATA_LICENSES.json), and [third-party notices](track_2b/docs/THIRD_PARTY_NOTICES.md) preserve third-party terms and distinguish code from data.

The retained `private: true` in package.json is an npm-publishing guard, not a repository-visibility or license declaration. Its historical staging description is preserved to avoid unnecessary runtime-context changes. Neither package manifest contains an original-work UNLICENSED declaration. The scoped root licenses govern the distributed original work.

No credentials, model weights, installed dependencies, human-subject records, other tracks, private Git history, or bulk raw evaluation archives are included. Four selected response examples and their provenance are retained, including historical private run URLs that may not open for readers; these are not public evidence-download promises. A separate Hugging Face dataset submission is not proposed.

## Verify the source files

With Python 3, run `make check-public` from an exact exported source/archive tree without `.git`, dependencies or generated outputs. An ordinary Git checkout contains extra metadata and is intentionally rejected. The distinct [public source manifest](PUBLIC_SOURCE_MANIFEST.v1.json) checks complete files/directories and bytes only. This checker launches no product, browser or provider. Its result is not runtime acceptance, authenticity, public clearance or submission. The sealed private checker and historical failure records remain privately preserved.

[Policy comparison](track_2b/docs/POLICY_CHANGE_REVIEW.md) · [Native-test export](track_2b/docs/NATIVE_REGRESSION_HANDOFF.md) · [Saved r5 response](track_2b/data/recordings/r5-sparse-candidate/README.md) · [Authored delivery fixture](track_2b/examples/delivery-review/README.md) · [Optional live configuration](track_2b/docs/LIVE_AND_DEPLOYMENT.md)
