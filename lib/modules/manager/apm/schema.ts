import { z } from 'zod/v4';
import { LooseArray } from '../../../util/schema-utils/index.ts';

/**
 * The object form of an APM dependency entry.
 *
 * The source is a git repository (`git`, with `path` naming a subdirectory and
 * `ref` pinning it), a local directory (`path` without `git`), a marketplace
 * plugin (`name` + `marketplace`, pinned by `version`), or a registry package
 * (`id`/`registry`, experimental). Keys that don't identify the source, such as
 * `alias` or `skills`, are not parsed here.
 */
export const ApmObjectDependency = z.object({
  git: z.string().optional(),
  id: z.string().optional(),
  marketplace: z.string().optional(),
  name: z.string().optional(),
  path: z.string().optional(),
  registry: z.string().optional(),
  ref: z.string().optional(),
  version: z.string().optional(),
});

export type ApmObjectDependency = z.infer<typeof ApmObjectDependency>;

/**
 * APM dependencies are declared under `dependencies.apm` / `devDependencies.apm`
 * as an array of either `[host/]owner/repo[/subpath]#<ref>` strings or objects.
 */
export const ApmDependencyEntry = z.union([z.string(), ApmObjectDependency]);

export type ApmDependencyEntry = z.infer<typeof ApmDependencyEntry>;

const ApmDependencySection = z.object({
  apm: LooseArray(ApmDependencyEntry).catch([]),
});

export const ApmManifest = z.object({
  dependencies: ApmDependencySection.optional(),
  devDependencies: ApmDependencySection.optional(),
});

export type ApmManifest = z.infer<typeof ApmManifest>;
