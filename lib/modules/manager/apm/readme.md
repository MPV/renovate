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

Only entries with a `#<ref>` are updated.
Entries without a `#<ref>` are skipped because there is no version to bump.

APM also documents pinning to a commit SHA with the release tag kept as a trailing comment (`owner/repo#<sha> # v2.0.0`).
With `pinDigests` enabled (part of the `config:best-practices` preset) Renovate keeps both the SHA and the tag comment current, the same way it does for `github-actions` (`uses: owner/action@<sha> # v4`).
A SHA pin without a tag comment is skipped, as there is no version to track.

When an `apm.lock.yaml` lockfile is present, Renovate refreshes it by running `apm install` after updating the manifest.
This requires the `apm` CLI to be available (for example, with `binarySource=global`).

### Semver ranges

APM also accepts a semver range as the ref, and resolves it against the repository's tags when installing:

```yaml
dependencies:
  apm:
    - owner/repo#^1.2.0
    - owner/repo#1.4.x
    - owner/repo#>=1.0.0 <2.0.0
    - owner/repo#1.2.3
```

A bare version such as `1.2.3` is an exact-version range in APM, not a literal tag.
Renovate keeps these refs as ranges and updates them with `npm` versioning, following your `rangeStrategy`.
It only considers the tags APM resolves ranges against: `v<version>`, `<name>--v<version>`, `<name>-v<version>` and a bare `<version>`.
`<name>` is the last segment of the entry's subpath, or the repository name if there is no subpath.

APM ranges can't contain `||`, so for a single comparator such as `^1.2.0` the `widen` strategy behaves like `replace`.
With the default `rangeStrategy=auto`, a compound range such as `>=1.0.0 <2.0.0` is widened, which keeps its lower bound.

Renovate skips refs that APM itself rejects, such as `~1.4` or `>=2.0 <3`, because APM needs every version in a range to be a full `x.y.z` version.
It also skips an uppercase `x.y.X` wildcard, because it can't keep that form when updating it.
