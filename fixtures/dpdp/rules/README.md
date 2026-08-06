# DPDP deterministic rule fixtures

Small positive/negative snippets for high-value DPDP controls.

- Each control lives under `DPDP-…/`.
- `positive.*` should trigger the expected open status (usually `VIOLATED` or `PARTIAL`).
- `negative.*` should not trigger that violation (often `NOT_OBSERVED`, `NOT_APPLICABLE`, or a weaker status).
- Cases are registered in `cases.json` and exercised by `tests/unit/dpdp.rules.test.ts`.

Values that look like real PII must be redacted in scan artifacts (asserted by the harness).
