import { isString, isTruthy } from '@sindresorhus/is';
import { logger } from '../../../logger/index.ts';
import { coerceArray } from '../../../util/array.ts';
import { detectPlatform } from '../../../util/common.ts';
import { parseGitUrl } from '../../../util/git/url.ts';
import { newlineRegex, regEx } from '../../../util/regex.ts';
import { isLongCommitSha } from '../../../util/schema-utils/git.ts';
import { parseSingleYaml } from '../../../util/yaml.ts';
import { GitTagsDatasource } from '../../datasource/git-tags/index.ts';
import { GithubTagsDatasource } from '../../datasource/github-tags/index.ts';
import { GitlabTagsDatasource } from '../../datasource/gitlab-tags/index.ts';
import type { PackageDependency, PackageFileContent } from '../types.ts';
import type { ApmDependencyEntry, ApmObjectDependency } from './schema.ts';
import { ApmManifest } from './schema.ts';

interface DatasourceResult {
  datasource: string;
  packageName: string;
  registryUrls?: string[];
}

/**
 * Where an APM dependency lives: the git host's base URL (`https://github.com`),
 * its `platform` as resolved by `detectPlatform` (which honors `hostRules`), the
 * repository path on that host, and the URL to list its tags from when the
 * host has no tags API.
 */
interface RepoLocation {
  baseUrl: string;
  platform: string | null;
  repoPath: string;
  cloneUrl: string;
}

/**
 * Determine which Renovate datasource to use for an APM dependency, based on
 * the git host `platform`. github/gitlab (and their self-hosted variants) map
 * to the `github-tags` / `gitlab-tags` datasources; every other host
 * (Bitbucket, Azure DevOps, etc.) falls back to the generic `git-tags`
 * datasource.
 */
function determineDatasource({
  baseUrl,
  platform,
  repoPath,
  cloneUrl,
}: RepoLocation): DatasourceResult {
  if (platform === 'github') {
    return {
      datasource: GithubTagsDatasource.id,
      packageName: repoPath,
      ...(baseUrl === 'https://github.com' ? {} : { registryUrls: [baseUrl] }),
    };
  }

  if (platform === 'gitlab') {
    return {
      datasource: GitlabTagsDatasource.id,
      packageName: repoPath,
      ...(baseUrl === 'https://gitlab.com' ? {} : { registryUrls: [baseUrl] }),
    };
  }

  return {
    datasource: GitTagsDatasource.id,
    packageName: cloneUrl,
  };
}

/** A trailing ` # <tag>` comment on a manifest line. */
const commentTagRegex = regEx(/^\s+#\s*(?<tag>\S.*?)\s*$/);

/**
 * Renders both `owner/repo#<tag>` and the digest-pinned
 * `owner/repo#<sha> # <tag>` form, mirroring the github-actions
 * `uses: owner/action@<sha> # v4` behaviour so `pinDigests` can pin a bare tag
 * to a SHA and keep the trailing tag comment current. `aliasSuffix` keeps an
 * SSH entry's `@<alias>` after the ref.
 */
function autoReplaceTemplate(aliasSuffix = ''): string {
  return `{{depName}}#{{#if newDigest}}{{newDigest}}${aliasSuffix} # {{newValue}}{{else}}{{newValue}}${aliasSuffix}{{/if}}`;
}

/** A clone URL: `https://`, `http://` or `ssh://`, or SCP-style `user@host:path`. */
const gitUrlRegex = regEx(/^(?:(?:https?|ssh):\/\/|[^@/\s]+@[^:/\s]+:)/);
const sshUrlRegex = regEx(/^(?:ssh:\/\/|[^@/\s]+@[^:/\s]+:)/);

/**
 * APM reads a trailing `@<alias>` on an SSH entry's ref as the name of the
 * install directory (`git@host:owner/repo.git#v1.0.0@my-alias`).
 */
const refAliasRegex = regEx(/^(?<ref>.+)@(?<alias>[a-zA-Z0-9._-]+)$/);

/**
 * APM virtual-package subpaths (skills/prompts/etc.) begin at one of these
 * "primitive" directories or at a file with a virtual extension. APM only uses
 * these to find where a repo path ends for hosts with nested namespaces; see
 * `_GITLAB_VIRTUAL_ROOT_SEGMENTS` / `VIRTUAL_FILE_EXTENSIONS` in apm.
 */
const virtualRootSegments = new Set(['prompts', 'instructions', 'collections']);
const virtualFileRegex = regEx(/\.(?:prompt|instructions|chatmode|agent)\.md$/);

/**
 * Resolve the repository path from the host-stripped path segments.
 *
 * GitHub repos are always `owner/repo`. GitLab (and other hosts) allow nested
 * groups, so the project slug can span 3+ segments; the virtual-package subpath,
 * if any, begins at a primitive directory or virtual file (index >= 2). Returns
 * `null` when there is no `owner/repo` (fewer than two segments).
 */
function resolveRepoPath(
  platform: string | null,
  segments: string[],
): string | null {
  if (segments.length < 2) {
    return null;
  }
  if (platform === 'github') {
    return segments.slice(0, 2).join('/');
  }
  let boundary = segments.length;
  for (let i = 2; i < segments.length; i++) {
    if (
      virtualRootSegments.has(segments[i]) ||
      virtualFileRegex.test(segments[i])
    ) {
      boundary = i;
      break;
    }
  }
  return segments.slice(0, boundary).join('/');
}

/**
 * Locate a shorthand `[host/]owner/repo[/subpath]` entry. The optional host
 * prefix is a hostname (so it contains a dot); git host owner names never do,
 * which disambiguates the leading segment.
 */
function parseShorthandLocation(pathPart: string): RepoLocation | null {
  const segments = pathPart.split('/').filter(isTruthy);
  const hasHost = (segments[0] ?? '').includes('.');
  const baseUrl = `https://${hasHost ? segments[0] : 'github.com'}`;
  const platform = detectPlatform(baseUrl);
  const repoPath = resolveRepoPath(
    platform,
    hasHost ? segments.slice(1) : segments,
  );
  if (!repoPath) {
    return null;
  }
  return { baseUrl, platform, repoPath, cloneUrl: `${baseUrl}/${repoPath}` };
}

/**
 * Locate a clone URL entry. APM doesn't allow a subpath inside a URL, so the
 * whole path is the repository, which also covers nested GitLab groups. Tags
 * are listed from the URL as written, so an SSH URL keeps its transport.
 */
function parseUrlLocation(url: string): RepoLocation | null {
  let parsed: ReturnType<typeof parseGitUrl>;
  try {
    parsed = parseGitUrl(url);
  } catch {
    return null;
  }
  const { resource, protocol, port, full_name: repoPath } = parsed;
  if (!repoPath.includes('/')) {
    return null;
  }
  // An SSH URL's port belongs to SSH, not to the host's web address.
  const isHttp = protocol === 'http' || protocol === 'https';
  const baseUrl = `${protocol === 'http' ? 'http' : 'https'}://${resource}${isHttp && port ? `:${port}` : ''}`;
  return {
    baseUrl,
    platform: detectPlatform(baseUrl),
    repoPath,
    cloneUrl: url,
  };
}

function parseLocation(location: string): RepoLocation | null {
  return gitUrlRegex.test(location)
    ? parseUrlLocation(location)
    : parseShorthandLocation(location);
}

interface PinnedTail {
  replaceString: string;
  currentValue: string;
}

/**
 * APM keeps the release tag for a SHA-pinned dependency in a trailing YAML
 * comment (`owner/repo#<sha> # v2.0.0`), which the structured parse strips.
 *
 * Returns a matcher that scans the raw manifest for the (unquoted) entry to
 * recover the tag as `currentValue` and the exact text to replace, so
 * `pinDigests` can update both the SHA and the tag. Each line is consumed at
 * most once (in file order), so the same `owner/repo#<sha>` pinned in more than
 * one section maps to distinct lines rather than all resolving to the first
 * match. Yields `undefined` for a bare SHA (no tag comment) or a form we can't
 * recover verbatim (e.g. quoted), which the caller then skips.
 */
function createPinnedTailFinder(
  content: string,
): (value: string) => PinnedTail | undefined {
  const lines = content.split(newlineRegex);
  const consumed = new Set<number>();
  return (value) => {
    for (let i = 0; i < lines.length; i++) {
      if (consumed.has(i)) {
        continue;
      }
      const item = lines[i].trimStart();
      if (!item.startsWith('-')) {
        continue;
      }
      const afterDash = item.slice(1).trimStart();
      if (!afterDash.startsWith(value)) {
        continue;
      }
      consumed.add(i);
      const tail = commentTagRegex.exec(afterDash.slice(value.length));
      if (!tail?.groups?.tag) {
        return undefined;
      }
      return {
        replaceString: afterDash.trimEnd(),
        currentValue: tail.groups.tag,
      };
    }
    return undefined;
  };
}

interface RefLine {
  quote: string;
  value: string;
  /** The whitespace and comment after the value, if any. */
  tail: string;
}

/** A `ref:` key of an object entry, possibly the entry's first key. */
const refLineRegex = regEx(/^\s*(?:-\s+)?ref:\s+(?<rest>\S.*)$/);
const commentStartRegex = regEx(/\s#/);
/**
 * The tag in the comment after a SHA-pinned ref is the comment's first word, so
 * a note after it (`# v2.0.0 # reviewed`) is kept rather than read as the tag.
 */
const refTagCommentRegex = regEx(/^(?<comment>\s+#\s*(?<tag>\S+))/);

/**
 * Splits a YAML value into its unquoted text and the comment after it. A quoted
 * value that continues on the next line yields text that matches no ref.
 */
function parseRefLine(rest: string): RefLine {
  const quote = rest.startsWith('"') || rest.startsWith("'") ? rest[0] : '';
  if (quote) {
    const end = rest.indexOf(quote, 1);
    return { quote, value: rest.slice(1, end), tail: rest.slice(end + 1) };
  }
  const commentIndex = rest.search(commentStartRegex);
  const end = commentIndex === -1 ? rest.length : commentIndex;
  return { quote, value: rest.slice(0, end), tail: rest.slice(end) };
}

/**
 * The object form keeps its ref on its own `ref:` line, which the structured
 * parse reduces to a plain value. Returns a matcher that finds that line in
 * the raw manifest, so the update can keep its quotes, and a SHA pin's tag can
 * be recovered from the comment after it (`ref: <sha> # v2.0.0`). Like
 * `createPinnedTailFinder`, each line is consumed at most once, in file order.
 */
function createRefLineFinder(
  content: string,
): (value: string) => RefLine | undefined {
  const lines = content.split(newlineRegex);
  const consumed = new Set<number>();
  return (value) => {
    for (let i = 0; i < lines.length; i++) {
      if (consumed.has(i)) {
        continue;
      }
      const rest = refLineRegex.exec(lines[i])?.groups?.rest;
      const refLine = rest ? parseRefLine(rest.trimEnd()) : undefined;
      if (refLine?.value !== value) {
        continue;
      }
      consumed.add(i);
      return refLine;
    }
    return undefined;
  };
}

/**
 * Renders a `ref:` value as either `<tag>` or the digest-pinned
 * `<sha> # <tag>`, keeping the value's quotes around the ref but not the
 * comment.
 */
function refReplaceTemplate(quote: string): string {
  return `${quote}{{#if newDigest}}{{newDigest}}${quote} # {{newValue}}{{else}}{{newValue}}${quote}{{/if}}`;
}

/**
 * Parse a single APM dependency string: the shorthand
 * `[host/]owner/repo[/subpath...][#<ref>]`, or a clone URL with an optional
 * `#<ref>` (`https://host/owner/repo.git`, `git@host:owner/repo.git` or
 * `ssh://git@host/owner/repo.git`). `<ref>` is a semver tag/range, a branch, or
 * a commit SHA.
 *
 * For a SHA-pinned entry the release tag lives in a trailing YAML comment; when
 * present it is recovered from `content` so the entry updates as a digest
 * (`currentDigest` + `currentValue`). A bare SHA with no tag comment has no
 * version to track and is skipped.
 */
export function parseApmDependency(
  entry: string,
  depType: string,
  findPinnedTail: (value: string) => PinnedTail | undefined,
): PackageDependency {
  const hashIndex = entry.indexOf('#');
  const pathPart = hashIndex === -1 ? entry : entry.slice(0, hashIndex);
  const refPart = hashIndex === -1 ? '' : entry.slice(hashIndex + 1).trim();
  const refAlias = sshUrlRegex.test(pathPart)
    ? refAliasRegex.exec(refPart)?.groups
    : undefined;
  const ref = refAlias?.ref ?? refPart;

  const base: PackageDependency = {
    depName: pathPart,
    depType,
  };

  if (!ref) {
    // Unpinned dependency (no `#ref`) - nothing for Renovate to update.
    return { ...base, skipReason: 'unspecified-version' };
  }

  const location = parseLocation(pathPart);

  if (!location) {
    logger.debug({ entry }, 'apm: could not determine owner/repo');
    return {
      ...base,
      currentValue: ref,
      skipReason: 'invalid-dependency-specification',
    };
  }

  const { datasource, packageName, registryUrls } =
    determineDatasource(location);
  const dep: PackageDependency = {
    ...base,
    datasource,
    packageName,
    ...(registryUrls ? { registryUrls } : {}),
    autoReplaceStringTemplate: autoReplaceTemplate(
      refAlias ? `@${refAlias.alias}` : '',
    ),
  };

  if (isLongCommitSha(ref)) {
    const tail = findPinnedTail(entry);
    if (!tail) {
      // Bare SHA with no recoverable tag comment - no version to track.
      return {
        ...base,
        currentDigest: ref,
        skipReason: 'unversioned-reference',
      };
    }
    return {
      ...dep,
      currentValue: tail.currentValue,
      currentDigest: ref,
      replaceString: tail.replaceString,
    };
  }

  return {
    ...dep,
    currentValue: ref,
    replaceString: entry,
  };
}

/**
 * Parse a git object entry, whose `git` value takes any of the string forms
 * (without a ref) and whose ref is on its own `ref:` line. The update rewrites
 * only that line's value, so the entry's other keys are left alone. A `path`
 * beside `git` is a subdirectory of the repository.
 */
function parseGitObjectDependency(
  git: string,
  { ref, type }: ApmObjectDependency,
  depType: string,
  findRefLine: (value: string) => RefLine | undefined,
): PackageDependency {
  const base: PackageDependency = { depName: git, depType };

  if (!ref) {
    return { ...base, skipReason: 'unspecified-version' };
  }

  const location = parseLocation(git);
  if (!location) {
    logger.debug({ git }, 'apm: could not determine owner/repo');
    return {
      ...base,
      currentValue: ref,
      skipReason: 'invalid-dependency-specification',
    };
  }
  if (type === 'gitlab') {
    // Marks a self-managed GitLab whose hostname doesn't say so.
    location.platform = 'gitlab';
  }

  const refLine = findRefLine(ref);
  if (!refLine) {
    // Not a block-style `ref:` line (such as a flow mapping), so there is no
    // single value to rewrite.
    logger.debug({ git, ref }, 'apm: could not find the ref line');
    return { ...base, currentValue: ref, skipReason: 'unsupported' };
  }

  const dep: PackageDependency = {
    ...base,
    ...determineDatasource(location),
    autoReplaceStringTemplate: refReplaceTemplate(refLine.quote),
  };
  const quotedRef = `${refLine.quote}${ref}${refLine.quote}`;

  if (isLongCommitSha(ref)) {
    const tagComment = refTagCommentRegex.exec(refLine.tail)?.groups;
    if (!tagComment) {
      // Bare SHA with no tag comment - no version to track.
      return {
        ...base,
        currentDigest: ref,
        skipReason: 'unversioned-reference',
      };
    }
    return {
      ...dep,
      currentValue: tagComment.tag,
      currentDigest: ref,
      replaceString: `${quotedRef}${tagComment.comment}`,
    };
  }

  return { ...dep, currentValue: ref, replaceString: quotedRef };
}

/**
 * Parse the object form of an APM dependency entry.
 *
 * The source is a git repository (`git`), a marketplace plugin (`marketplace`),
 * a registry package (`id`/`registry`) or a local directory (`path` without
 * `git`). Only git entries map to a datasource; the others are reported with a
 * `skipReason` rather than dropped, so an unsupported entry is visibly
 * unsupported instead of looking up to date.
 */
export function parseApmObjectDependency(
  entry: ApmObjectDependency,
  depType: string,
  findRefLine: (value: string) => RefLine | undefined,
): PackageDependency {
  if (entry.git === 'parent') {
    // A sibling in the repository of the package declaring it, installed at
    // that package's own ref.
    return { depName: entry.path, depType, skipReason: 'inherited-dependency' };
  }

  if (entry.git) {
    return parseGitObjectDependency(entry.git, entry, depType, findRefLine);
  }

  if (entry.marketplace) {
    // Resolved through a marketplace registered with the APM CLI on the
    // installing machine, which the repository doesn't identify.
    return {
      depName: `${entry.name}@${entry.marketplace}`,
      depType,
      ...(entry.version ? { currentValue: entry.version } : {}),
      skipReason: 'unknown-registry',
    };
  }

  const registryPackage = entry.id ?? entry.registry;
  if (registryPackage) {
    // Resolved through APM's registry, for which Renovate has no datasource.
    return {
      depName: registryPackage,
      depType,
      ...(entry.version ? { currentValue: entry.version } : {}),
      skipReason: 'unsupported-datasource',
    };
  }

  if (entry.path) {
    // A local dependency has no upstream to track.
    return { depName: entry.path, depType, skipReason: 'local-dependency' };
  }

  logger.debug({ entry }, 'apm: object entry declares no known source');
  return { depType, skipReason: 'invalid-dependency-specification' };
}

interface LineFinders {
  findPinnedTail: (value: string) => PinnedTail | undefined;
  findRefLine: (value: string) => RefLine | undefined;
}

function extractSection(
  entries: ApmDependencyEntry[] | undefined,
  depType: string,
  { findPinnedTail, findRefLine }: LineFinders,
): PackageDependency[] {
  return coerceArray(entries).map((entry) =>
    isString(entry)
      ? parseApmDependency(entry, depType, findPinnedTail)
      : parseApmObjectDependency(entry, depType, findRefLine),
  );
}

export function extractPackageFile(
  content: string,
  packageFile: string,
): PackageFileContent | null {
  let manifest: ApmManifest;
  try {
    manifest = parseSingleYaml(content, { customSchema: ApmManifest });
  } catch (err) {
    logger.debug({ packageFile, err }, 'apm: failed to parse manifest');
    return null;
  }

  const finders: LineFinders = {
    findPinnedTail: createPinnedTailFinder(content),
    findRefLine: createRefLineFinder(content),
  };
  const deps = [
    ...extractSection(manifest.dependencies?.apm, 'apm', finders),
    ...extractSection(manifest.devDependencies?.apm, 'apm-dev', finders),
  ];

  if (!deps.length) {
    return null;
  }

  return { deps };
}
