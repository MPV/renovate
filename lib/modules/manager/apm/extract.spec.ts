import { codeBlock } from 'common-tags';
import { describe, expect, it } from 'vitest';
import { regEx } from '../../../util/regex.ts';
import { GitTagsDatasource } from '../../datasource/git-tags/index.ts';
import { GithubTagsDatasource } from '../../datasource/github-tags/index.ts';
import { GitlabTagsDatasource } from '../../datasource/gitlab-tags/index.ts';
import { extractPackageFile } from './extract.ts';

const packageFile = 'apm.yml';

describe('modules/manager/apm/extract', () => {
  describe('extractPackageFile()', () => {
    it('returns null for invalid YAML', () => {
      expect(extractPackageFile('foo: *bar', packageFile)).toBeNull();
    });

    it('returns null when parsed content is not an object', () => {
      expect(extractPackageFile('just a string', packageFile)).toBeNull();
    });

    it('returns null when there are no dependencies', () => {
      const content = codeBlock`
        name: your-project
        version: 1.0.0
      `;
      expect(extractPackageFile(content, packageFile)).toBeNull();
    });

    it('returns null when apm section is not an array', () => {
      const content = codeBlock`
        name: your-project
        dependencies:
          apm: not-an-array
      `;
      expect(extractPackageFile(content, packageFile)).toBeNull();
    });

    it('extracts github dependencies (default host)', () => {
      const content = codeBlock`
        name: your-project
        version: 1.0.0
        dependencies:
          apm:
            - microsoft/apm-sample-package#v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)).toEqual({
        deps: [
          {
            depName: 'microsoft/apm-sample-package',
            depType: 'apm',
            currentValue: 'v1.0.0',
            datasource: GithubTagsDatasource.id,
            packageName: 'microsoft/apm-sample-package',
            replaceString: 'microsoft/apm-sample-package#v1.0.0',
            autoReplaceStringTemplate:
              '{{depName}}#{{#if newDigest}}{{newDigest}} # {{newValue}}{{else}}{{newValue}}{{/if}}',
          },
        ],
      });
    });

    it('parses the SHA-pinned digest form (tag recovered from comment)', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - owner/tool#v1.0.0
            - acme/playbooks#b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123 # v2.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        { depName: 'owner/tool', currentValue: 'v1.0.0' },
        {
          depName: 'acme/playbooks',
          packageName: 'acme/playbooks',
          datasource: GithubTagsDatasource.id,
          currentDigest: 'b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123',
          currentValue: 'v2.0.0',
          replaceString:
            'acme/playbooks#b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123 # v2.0.0',
        },
      ]);
    });

    it('maps a SHA pinned in both sections to its own line', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - acme/playbooks#b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123 # v2.0.0
        devDependencies:
          apm:
            - acme/playbooks#b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123 # v2.1.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depType: 'apm',
          currentValue: 'v2.0.0',
          replaceString:
            'acme/playbooks#b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123 # v2.0.0',
        },
        {
          depType: 'apm-dev',
          currentValue: 'v2.1.0',
          replaceString:
            'acme/playbooks#b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123 # v2.1.0',
        },
      ]);
    });

    it('emits a digest dep for a SHA pin on a git-tags host', () => {
      // git-tags resolves digests via `git ls-remote`, so the SHA is preserved
      // on a bump rather than dropped to a digest-less tag.
      const content = codeBlock`
        dependencies:
          apm:
            - bitbucket.org/team/project#b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123 # v2.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'bitbucket.org/team/project',
          packageName: 'https://bitbucket.org/team/project',
          datasource: GitTagsDatasource.id,
          currentDigest: 'b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123',
          currentValue: 'v2.0.0',
        },
      ]);
    });

    it('skips a bare SHA with no tag comment', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - acme/playbooks#b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'acme/playbooks',
          currentDigest: 'b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123',
          skipReason: 'unversioned-reference',
        },
      ]);
    });

    it('skips a quoted SHA-pin (exact text not recoverable)', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - "acme/playbooks#b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123" # v2.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'acme/playbooks',
          currentDigest: 'b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123',
          skipReason: 'unversioned-reference',
        },
      ]);
    });

    it('keeps subpath in depName but uses owner/repo as packageName', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - anthropics/skills/skills/frontend-design#v1.2.3
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'anthropics/skills/skills/frontend-design',
          packageName: 'anthropics/skills',
          datasource: GithubTagsDatasource.id,
          currentValue: 'v1.2.3',
        },
      ]);
    });

    it('handles dots in repo names and subpaths', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - owner/repo.js#v1.0.0
            - github/awesome-copilot/agents/api-architect.agent.md#v2.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'owner/repo.js',
          packageName: 'owner/repo.js',
          datasource: GithubTagsDatasource.id,
          currentValue: 'v1.0.0',
        },
        {
          depName: 'github/awesome-copilot/agents/api-architect.agent.md',
          packageName: 'github/awesome-copilot',
          datasource: GithubTagsDatasource.id,
          currentValue: 'v2.0.0',
        },
      ]);
    });

    it('extracts gitlab.com dependencies', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - gitlab.com/team/project#v2.3.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'gitlab.com/team/project',
          packageName: 'team/project',
          datasource: GitlabTagsDatasource.id,
          currentValue: 'v2.3.0',
        },
      ]);
      expect(
        extractPackageFile(content, packageFile)?.deps[0].registryUrls,
      ).toBeUndefined();
    });

    it('supports GitLab nested groups (project slug spans 3+ segments)', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - gitlab.com/group/subgroup/project#v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'gitlab.com/group/subgroup/project',
          packageName: 'group/subgroup/project',
          datasource: GitlabTagsDatasource.id,
          currentValue: 'v1.0.0',
        },
      ]);
    });

    it('splits a GitLab nested project from a virtual subpath', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - gitlab.com/group/subgroup/project/prompts/foo#v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'gitlab.com/group/subgroup/project/prompts/foo',
          packageName: 'group/subgroup/project',
          datasource: GitlabTagsDatasource.id,
          currentValue: 'v1.0.0',
        },
      ]);
    });

    it('treats a GitLab .chatmode.md virtual file as a subpath boundary', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - gitlab.com/group/subgroup/project/my.chatmode.md#v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'gitlab.com/group/subgroup/project/my.chatmode.md',
          packageName: 'group/subgroup/project',
          datasource: GitlabTagsDatasource.id,
          currentValue: 'v1.0.0',
        },
      ]);
    });

    it('extracts self-hosted github dependencies with registryUrls', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - github.example.com/team/project#v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          packageName: 'team/project',
          datasource: GithubTagsDatasource.id,
          registryUrls: ['https://github.example.com'],
        },
      ]);
    });

    it('extracts self-hosted gitlab dependencies with registryUrls', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - gitlab.example.com/team/project#v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          packageName: 'team/project',
          datasource: GitlabTagsDatasource.id,
          registryUrls: ['https://gitlab.example.com'],
        },
      ]);
    });

    it('falls back to git-tags for other hosts', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - bitbucket.org/team/project#v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'bitbucket.org/team/project',
          packageName: 'https://bitbucket.org/team/project',
          datasource: GitTagsDatasource.id,
          currentValue: 'v1.0.0',
        },
      ]);
    });

    it('skips unpinned dependencies', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - anthropics/skills/skills/frontend-design
            - owner/repo#
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'anthropics/skills/skills/frontend-design',
          skipReason: 'unspecified-version',
        },
        {
          depName: 'owner/repo',
          skipReason: 'unspecified-version',
        },
      ]);
    });

    it('marks entries without owner/repo as invalid', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - foo#v1.0.0
            - gitlab.com/foo#v1.0.0
            - '#v1.0.0'
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'foo',
          currentValue: 'v1.0.0',
          skipReason: 'invalid-dependency-specification',
        },
        {
          depName: 'gitlab.com/foo',
          currentValue: 'v1.0.0',
          skipReason: 'invalid-dependency-specification',
        },
        {
          depName: '',
          currentValue: 'v1.0.0',
          skipReason: 'invalid-dependency-specification',
        },
      ]);
    });

    it('extracts devDependencies with apm-dev depType', () => {
      const content = codeBlock`
        devDependencies:
          apm:
            - owner/repo#v1.2.3
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'owner/repo',
          depType: 'apm-dev',
          currentValue: 'v1.2.3',
        },
      ]);
    });

    it('ignores MCP entries and non-string entries', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - owner/repo#v1.0.0
            - name: nested-object-should-be-skipped
          mcp:
            - name: io.github.github/github-mcp-server
              transport: http
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'owner/repo',
          depType: 'apm',
          currentValue: 'v1.0.0',
          datasource: GithubTagsDatasource.id,
          packageName: 'owner/repo',
          replaceString: 'owner/repo#v1.0.0',
          autoReplaceStringTemplate:
            '{{depName}}#{{#if newDigest}}{{newDigest}} # {{newValue}}{{else}}{{newValue}}{{/if}}',
        },
      ]);
    });

    describe('semver range refs', () => {
      it('keeps a range ref as a range with npm versioning', () => {
        const content = codeBlock`
          dependencies:
            apm:
              - owner/repo#^1.2.0
        `;
        expect(extractPackageFile(content, packageFile)?.deps).toEqual([
          {
            depName: 'owner/repo',
            depType: 'apm',
            currentValue: '^1.2.0',
            datasource: GithubTagsDatasource.id,
            packageName: 'owner/repo',
            replaceString: 'owner/repo#^1.2.0',
            autoReplaceStringTemplate:
              '{{depName}}#{{#if newDigest}}{{newDigest}} # {{newValue}}{{else}}{{newValue}}{{/if}}',
            versioning: 'npm',
            extractVersion: expect.any(String),
          },
        ]);
      });

      it.each`
        ref
        ${'^1.2.0'}
        ${'~1.4.0'}
        ${'1.2.x'}
        ${'1.2.*'}
        ${'1.2.3'}
        ${'=1.2.3'}
        ${'>1.2.3'}
        ${'<=2.0.0'}
        ${'>=1.0.0 <2.0.0'}
        ${'^1.2.0-rc.1'}
        ${'1.2.3+build.5'}
      `('keeps $ref as a range', ({ ref }) => {
        const content = codeBlock`
          dependencies:
            apm:
              - owner/repo#${ref}
        `;
        expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
          {
            currentValue: ref,
            replaceString: `owner/repo#${ref}`,
            versioning: 'npm',
          },
        ]);
      });

      it.each`
        entry                                           | tag                   | version
        ${'owner/repo#^1.2.0'}                          | ${'v1.2.0'}           | ${'1.2.0'}
        ${'owner/repo#^1.2.0'}                          | ${'repo--v1.3.0'}     | ${'1.3.0'}
        ${'owner/repo#^1.2.0'}                          | ${'repo-v1.4.0'}      | ${'1.4.0'}
        ${'owner/repo#^1.2.0'}                          | ${'1.5.0'}            | ${'1.5.0'}
        ${'owner/repo#^1.2.0'}                          | ${'v2.0.0-rc.1'}      | ${'2.0.0-rc.1'}
        ${'owner/repo#^1.2.0'}                          | ${'other--v9.0.0'}    | ${undefined}
        ${'owner/repo#^1.2.0'}                          | ${'v1.2'}             | ${undefined}
        ${'owner/repo#^1.2.0'}                          | ${'latest'}           | ${undefined}
        ${'owner/repo/plugins/foo#^1.2.0'}              | ${'foo--v1.2.0'}      | ${'1.2.0'}
        ${'owner/repo/plugins/foo#^1.2.0'}              | ${'foo-v1.2.0'}       | ${'1.2.0'}
        ${'owner/repo/plugins/foo#^1.2.0'}              | ${'v1.2.0'}           | ${'1.2.0'}
        ${'owner/repo/plugins/foo#^1.2.0'}              | ${'bar--v1.2.0'}      | ${undefined}
        ${'owner/repo/plugins/foo#^1.2.0'}              | ${'repo--v1.2.0'}     | ${undefined}
        ${'owner/repo/skills/my.skill#^1.0.0'}          | ${'my.skill--v1.0.0'} | ${'1.0.0'}
        ${'owner/repo/skills/my.skill#^1.0.0'}          | ${'myXskill--v1.0.0'} | ${undefined}
        ${'owner/repo/prompts/review.prompt.md#^1.0.0'} | ${'repo--v1.0.0'}     | ${'1.0.0'}
        ${'gitlab.com/group/sub/project#^1.0.0'}        | ${'project--v1.0.0'}  | ${'1.0.0'}
      `(
        'reads tag $tag as version $version for $entry',
        ({ entry, tag, version }) => {
          const content = codeBlock`
            dependencies:
              apm:
                - ${entry}
          `;
          const [dep] = extractPackageFile(content, packageFile)!.deps;
          expect(regEx(dep.extractVersion!).exec(tag)?.groups?.version).toBe(
            version,
          );
        },
      );

      it.each`
        ref
        ${'~1.4'}
        ${'>=2.0 <3'}
        ${'^1.2'}
        ${'>=1.0.0 <2'}
        ${'>= 1.0.0'}
        ${'==1.2.3'}
      `('skips $ref, which APM rejects', ({ ref }) => {
        const content = codeBlock`
          dependencies:
            apm:
              - owner/repo#${ref}
        `;
        expect(extractPackageFile(content, packageFile)?.deps).toEqual([
          {
            depName: 'owner/repo',
            depType: 'apm',
            currentValue: ref,
            skipReason: 'invalid-version',
          },
        ]);
      });

      it('skips an uppercase X wildcard', () => {
        const content = codeBlock`
          dependencies:
            apm:
              - owner/repo#1.2.X
        `;
        expect(extractPackageFile(content, packageFile)?.deps).toEqual([
          {
            depName: 'owner/repo',
            depType: 'apm',
            currentValue: '1.2.X',
            skipReason: 'unsupported-version',
          },
        ]);
      });

      it.each`
        ref
        ${'v1.2.3'}
        ${'main'}
        ${'foo--v1.0.0'}
        ${'1.2'}
      `('leaves literal ref $ref unchanged', ({ ref }) => {
        const content = codeBlock`
          dependencies:
            apm:
              - owner/repo#${ref}
        `;
        const [dep] = extractPackageFile(content, packageFile)!.deps;
        expect(dep).toMatchObject({ currentValue: ref });
        expect(dep).not.toHaveProperty('versioning');
        expect(dep).not.toHaveProperty('extractVersion');
        expect(dep).not.toHaveProperty('skipReason');
      });
    });
  });
});
