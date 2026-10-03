# Machine envelope (`scan --report envelope`)

The machine envelope is a stable, versioned JSON document for tools that run VibeDoctor and consume its results. It is printed as exactly one JSON document on standard output; progress and errors go to standard error.

```bash
vibedoctor scan --root ./repo --profile static --report envelope > envelope.json
```

## Versioning

- `schema` is always `vibedoctor.machine-envelope`.
- `schemaVersion` is semantic. Additive fields keep the major version, so consumers should tolerate unknown fields. A consumer must reject a major version it does not know rather than treat the document as an empty result.
- The JSON Schema is [schemas/machine-envelope.v1.schema.json](../schemas/machine-envelope.v1.schema.json).

## Outcomes are separate

| Field | Meaning |
| --- | --- |
| `execution.status` | `completed`. A scan that crashes writes **no** envelope and exits `70`. |
| `gate.exitCode` / `gate.status` | Same as the process exit code: `0` pass, `1` a configured health gate failed (`fail`), `2` required checks incomplete (`incomplete`). A completed scan with exit `1` or `2` still has a valid envelope. |
| `report.completeness` | Whether every planned tool ran. Exit `0` does not imply every scanner ran; check `report.capabilityMatrix`. |

## Fields

| Field | Description |
| --- | --- |
| `producer` | `{ name, version }` of VibeDoctor. |
| `run` | `id` (UUID), `startedAt`, `finishedAt`, scan `mode`, execution `profile`, whether `network` was allowed, and the `categories` filter. |
| `repository.root` | Absolute path that was scanned. |
| `repository.source` | Content fingerprint of the scanned files (below), taken before any tool ran. |
| `repository.git` | `head` commit, whether the work tree was `dirty`, and the number of `changedFiles`; all `null` outside git. A commit alone does not identify uncommitted edits, so use `repository.source` for identity. |
| `config` | Path of the configuration file (or `null`) and a SHA-256 fingerprint of the effective configuration. |
| `report` | The unchanged `--report json` document. In the envelope only, every finding (in `findings`, `topFindings`, `privacyFindings`, `dpdpFindings` and `suppressedFindings`) also has `fingerprint`: the same stable identity VibeDoctor uses for baselines. Finding `id`s can change between runs; fingerprints are the identity to compare. |

## Source fingerprint: `sha256-tree-v1`

Any tool can recompute this to check that an envelope describes the files it has:

1. Walk the root recursively. Skip symbolic links and directories named `.git`, `.vibedoctor`, `node_modules`, `.venv`, `venv`, `__pycache__` and `.world`.
2. For every regular file, take its path relative to the root with `/` separators, and the lowercase hex SHA-256 of its bytes.
3. Sort the paths by code-unit order. If there are more than 50,000, keep the first 50,000 and set `truncated: true`.
4. The value is the lowercase hex SHA-256 of the concatenation of `${path}\0${sha256}\n` for each file.

The result is `{ algorithm: "sha256-tree-v1", value, files, truncated }`.

## Evidence grades are not exploit proof

`evidenceGrade: "verified"` means a tool established the finding (for example a type error from `tsc`, or a statically traced code path). It does not mean the issue was reproduced at runtime.
