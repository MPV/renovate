The `apm` manager keeps [APM (Agent Package Manager)](https://github.com/microsoft/apm) dependencies up to date.

Renovate reads the `apm.yml` manifest and updates the git-pinned entries under `dependencies.apm` and `devDependencies.apm`.
Each entry uses the form `[host/]owner/repo[/subpath]#<ref>`, for example:

```yaml
name: your-project
version: 1.0.0
dependencies:
  apm:
    - microsoft/apm-sample-package#v1.0.0
    - gitlab.com/team/project#v2.3.0
devDependencies:
  apm:
    - owner/repo#v1.2.3
```

Only entries that pin an exact `#<ref>` are updated.
Entries without a `#<ref>` are skipped because there is no version to bump.

APM also documents pinning to a commit SHA with the release tag kept as a trailing comment (`owner/repo#<sha> # v2.0.0`).
With `pinDigests` enabled (part of the `config:best-practices` preset) Renovate keeps both the SHA and the tag comment current, the same way it does for `github-actions` (`uses: owner/action@<sha> # v4`).
A SHA pin without a tag comment is skipped, as there is no version to track.

## Object form entries

APM also accepts an object form, where the source is given by one of `git`, `id`, `path` or `registry`:

```yaml
dependencies:
  apm:
    - git: https://github.com/owner/repo.git
      ref: main
      skills:
        - some-skill
    - id: some-registry-package
      version: 1.2.3
    - path: ./local/skills
```

Renovate reports these entries but does not update them yet, so each is listed with a skip reason:

| Entry            | Skip reason              | Why                                                                                           |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `git`            | `unsupported`            | updatable in principle, but the ref lives on its own key and needs a separate write-back path |
| `id`, `registry` | `unsupported-datasource` | resolved through APM's registry, for which Renovate has no datasource                         |
| `path`           | `local-dependency`       | a local dependency has no upstream to track                                                   |

When an `apm.lock.yaml` lockfile is present, Renovate refreshes it by running `apm install` after updating the manifest.
This requires the `apm` CLI to be available (for example, with `binarySource=global`).
