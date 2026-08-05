import { resolveConfigPresets } from '../index.ts';
import { presets } from './helpers.preset.ts';

describe('config/presets/internal/helpers.preset', () => {
  describe('pinGitHubActionDigestsToSemver', () => {
    it('resolves to package rules that pin digests and apply semver', async () => {
      const { config } = await resolveConfigPresets({
        extends: ['helpers:pinGitHubActionDigestsToSemver'],
      });

      // No nested `packageRules` should leak into an individual rule.
      for (const rule of config.packageRules!) {
        expect(rule).not.toHaveProperty('packageRules');
      }

      // `pinDigests` must be applied to `action` deps.
      expect(config.packageRules).toContainEqual(
        expect.objectContaining({
          matchDepTypes: ['action'],
          pinDigests: true,
        }),
      );

      // The semver `extractVersion`/`versioning` must be scoped to `action`
      // deps, not applied unconditionally.
      expect(config.packageRules).toContainEqual(
        expect.objectContaining({
          matchDepTypes: ['action'],
          extractVersion: '^(?<version>v?\\d+\\.\\d+\\.\\d+)$',
          versioning:
            'regex:^v?(?<major>\\d+)(\\.(?<minor>\\d+)\\.(?<patch>\\d+))?$',
        }),
      );
    });

    it('does not define package rules with an unconditional versioning', () => {
      const preset = presets.pinGitHubActionDigestsToSemver;
      for (const rule of preset.packageRules!) {
        if (rule.versioning ?? rule.extractVersion) {
          expect(rule.matchDepTypes).toEqual(['action']);
        }
      }
    });
  });
});
