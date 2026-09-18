import { z } from 'zod/v4';
import { LooseArray } from '../../../util/schema-utils/index.ts';

/**
 * The object form of an APM dependency entry.
 *
 * APM's manifest schema requires exactly one of `git`, `id`, `path` or
 * `registry` as the source discriminator, and allows `ref`/`version` to pin it.
 * `alias`, `skills` and `prerelease` are also permitted but do not identify the
 * source, so they are not parsed here.
 */
export const ApmObjectDependency = z.object({
  git: z.string().optional(),
  id: z.string().optional(),
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
