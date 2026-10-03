The `apm` manager keeps [APM (Agent Package Manager)](https://github.com/microsoft/apm) dependencies up to date.

Renovate reads the `apm.yml` manifest and updates the git-pinned entries under `dependencies.apm` and `devDependencies.apm`.
Each entry is either the shorthand `[host/]owner/repo[/subpath]#<ref>` or a clone URL followed by `#<ref>`, for example:

```yaml
name: your-project
version: 1.0.0
dependencies:
  apm:
    - microsoft/apm-sample-package#v1.0.0
    - gitlab.com/team/project#v2.3.0
    - git@gitlab.com:team/other-project.git#v1.4.0
devDependencies:
  apm:
    - owner/repo#v1.2.3
```

A clone URL can be `https://host/owner/repo.git`, `git@host:owner/repo.git` or `ssh://git@host/owner/repo.git`.
Renovate looks it up the same way as the shorthand for that host.
On hosts without a tags API, Renovate lists the tags from the URL as written, so an SSH URL needs SSH access from wherever Renovate runs.
An SSH entry can end in `@<alias>` after the ref, which Renovate keeps when it updates the ref.

Only entries that pin an exact `#<ref>` are updated.
Entries without a `#<ref>` are skipped because there is no version to bump.

APM also documents pinning to a commit SHA with the release tag kept as a trailing comment (`owner/repo#<sha> # v2.0.0`).
With `pinDigests` enabled (part of the `config:best-practices` preset) Renovate keeps both the SHA and the tag comment current, the same way it does for `github-actions` (`uses: owner/action@<sha> # v4`).
A SHA pin without a tag comment is skipped, as there is no version to track.

When an `apm.lock.yaml` lockfile is present, Renovate refreshes it by running `apm install` after updating the manifest.
This requires the `apm` CLI to be available (for example, with `binarySource=global`).

### Object form entries

APM also accepts an object form, where the source is a git repository (`git`), a marketplace plugin (`marketplace`), a registry package (`id` or `registry`), or a local directory (`path` without `git`):

```yaml
dependencies:
  apm:
    - git: https://github.com/owner/repo.git
      path: skills/some-skill
      ref: main
    - name: some-plugin
      marketplace: some-marketplace
      version: ~2.1.0
    - id: some-registry-package
      version: 1.2.3
    - path: ./local/skills
```

Renovate reports these entries but does not update them yet, so each is listed with a skip reason:

| Entry                  | Skip reason              | Why                                                                                            |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `git`                  | `unsupported`            | updatable in principle, but the clone URL needs its own parsing before it maps to a datasource |
| `git: parent`          | `inherited-dependency`   | a sibling in the declaring package's own repository, installed at that package's ref           |
| `marketplace`          | `unknown-registry`       | marketplaces are registered with the APM CLI, so the repository doesn't say where it points    |
| `id`, `registry`       | `unsupported-datasource` | resolved through APM's registry, for which Renovate has no datasource                          |
| `path` (without `git`) | `local-dependency`       | a local dependency has no upstream to track                                                    |
