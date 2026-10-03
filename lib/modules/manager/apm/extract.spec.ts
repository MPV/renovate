import { codeBlock } from 'common-tags';
import { describe, expect, it } from 'vitest';
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

    it('ignores MCP entries and reports an object entry with no known source', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - owner/repo#v1.0.0
            - name: object-with-no-source-discriminator
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
        { depType: 'apm', skipReason: 'invalid-dependency-specification' },
      ]);
    });
  });

  describe('object form entries', () => {
    it('reports a local path dependency as skipped', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - path: ./local/skills
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: './local/skills',
          depType: 'apm',
          skipReason: 'local-dependency',
        },
      ]);
    });

    it('reports a registry id with its version but no datasource', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - id: some-registry-package
              version: 1.2.3
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'some-registry-package',
          depType: 'apm',
          currentValue: '1.2.3',
          skipReason: 'unsupported-datasource',
        },
      ]);
    });

    it('reports a registry-named entry without a version', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - registry: some-registry
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'some-registry',
          depType: 'apm',
          skipReason: 'unsupported-datasource',
        },
      ]);
    });

    it('extracts a git entry with its ref', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git: https://github.com/github/awesome-copilot.git
              ref: v1.2.0
              skills:
                - conventional-commit
              alias: github-awesome-copilot
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'https://github.com/github/awesome-copilot.git',
          depType: 'apm',
          currentValue: 'v1.2.0',
          datasource: GithubTagsDatasource.id,
          packageName: 'github/awesome-copilot',
          replaceString: 'v1.2.0',
          autoReplaceStringTemplate:
            '{{#if newDigest}}{{newDigest}} # {{newValue}}{{else}}{{newValue}}{{/if}}',
        },
      ]);
    });

    it('treats path beside git as a subpath, not a local dependency', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git: https://github.com/skydoves/compose-performance-skills.git
              ref: main
              path: modifiers/ordering-modifier-chains
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          depName: 'https://github.com/skydoves/compose-performance-skills.git',
          currentValue: 'main',
          datasource: GithubTagsDatasource.id,
          packageName: 'skydoves/compose-performance-skills',
        },
      ]);
    });

    it('reports a sibling in the parent repository as inherited', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git: parent
              path: skills/shared
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'skills/shared',
          depType: 'apm',
          skipReason: 'inherited-dependency',
        },
      ]);
    });

    it('reports a marketplace plugin as coming from an unknown registry', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - name: secrets-vault
              marketplace: acme-plugins
              version: "~2.1.0"
            - name: sec-check
              marketplace: acme-plugins
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'secrets-vault@acme-plugins',
          depType: 'apm',
          currentValue: '~2.1.0',
          skipReason: 'unknown-registry',
        },
        {
          depName: 'sec-check@acme-plugins',
          depType: 'apm',
          skipReason: 'unknown-registry',
        },
      ]);
    });

    it('skips a git entry with no ref', () => {
      const content = codeBlock`
        devDependencies:
          apm:
            - git: https://github.com/owner/repo.git
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'https://github.com/owner/repo.git',
          depType: 'apm-dev',
          skipReason: 'unspecified-version',
        },
      ]);
    });

    it('keeps string and object entries side by side', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - owner/repo#v1.0.0
            - git: https://github.com/other/repo.git
              ref: main
            - path: ./local
      `;
      const deps = extractPackageFile(content, packageFile)?.deps;
      expect(deps).toHaveLength(3);
      expect(deps?.map((dep) => dep.skipReason)).toEqual([
        undefined,
        undefined,
        'local-dependency',
      ]);
    });
  });

  describe('clone URL entries', () => {
    const template =
      '{{depName}}#{{#if newDigest}}{{newDigest}} # {{newValue}}{{else}}{{newValue}}{{/if}}';
    const sha = 'b1c2d3e4f5a6b7c8d9e0f1234567890abcdef123';

    it.each`
      entry                                                       | datasource                 | packageName                                      | registryUrls
      ${'https://github.com/owner/repo.git#v1.0.0'}               | ${GithubTagsDatasource.id} | ${'owner/repo'}                                  | ${undefined}
      ${'https://github.com/owner/repo#v1.0.0'}                   | ${GithubTagsDatasource.id} | ${'owner/repo'}                                  | ${undefined}
      ${'git@github.com:owner/repo.git#v1.0.0'}                   | ${GithubTagsDatasource.id} | ${'owner/repo'}                                  | ${undefined}
      ${'ssh://git@github.com/owner/repo.git#v1.0.0'}             | ${GithubTagsDatasource.id} | ${'owner/repo'}                                  | ${undefined}
      ${'https://gitlab.com/group/sub/repo.git#v1.0.0'}           | ${GitlabTagsDatasource.id} | ${'group/sub/repo'}                              | ${undefined}
      ${'git@gitlab.com:group/sub/repo.git#v1.0.0'}               | ${GitlabTagsDatasource.id} | ${'group/sub/repo'}                              | ${undefined}
      ${'https://gitlab.example.com:8443/team/repo.git#v1.0.0'}   | ${GitlabTagsDatasource.id} | ${'team/repo'}                                   | ${['https://gitlab.example.com:8443']}
      ${'ssh://git@gitlab.example.com:2222/team/repo.git#v1.0.0'} | ${GitlabTagsDatasource.id} | ${'team/repo'}                                   | ${['https://gitlab.example.com']}
      ${'myuser@bitbucket.org:team/repo.git#v1.0.0'}              | ${GitTagsDatasource.id}    | ${'myuser@bitbucket.org:team/repo.git'}          | ${undefined}
      ${'ssh://git@bitbucket.corp:7999/proj/repo.git#v1.0.0'}     | ${GitTagsDatasource.id}    | ${'ssh://git@bitbucket.corp:7999/proj/repo.git'} | ${undefined}
      ${'http://git.local:8080/owner/repo.git#v1.0.0'}            | ${GitTagsDatasource.id}    | ${'http://git.local:8080/owner/repo.git'}        | ${undefined}
      ${'https://dev.azure.com/org/proj/_git/repo#v1.0.0'}        | ${GitTagsDatasource.id}    | ${'https://dev.azure.com/org/proj/_git/repo'}    | ${undefined}
    `(
      'looks up $entry with $datasource',
      ({ entry, datasource, packageName, registryUrls }) => {
        const content = codeBlock`
          dependencies:
            apm:
              - ${entry}
        `;
        expect(extractPackageFile(content, packageFile)?.deps).toEqual([
          {
            depName: entry.slice(0, entry.indexOf('#')),
            depType: 'apm',
            currentValue: 'v1.0.0',
            datasource,
            packageName,
            ...(registryUrls ? { registryUrls } : {}),
            replaceString: entry,
            autoReplaceStringTemplate: template,
          },
        ]);
      },
    );

    it('keeps the @alias of an SSH entry when updating its ref', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git@github.com:owner/repo.git#v1.0.0@my-alias
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'git@github.com:owner/repo.git',
          depType: 'apm',
          currentValue: 'v1.0.0',
          datasource: GithubTagsDatasource.id,
          packageName: 'owner/repo',
          replaceString: 'git@github.com:owner/repo.git#v1.0.0@my-alias',
          autoReplaceStringTemplate:
            '{{depName}}#{{#if newDigest}}{{newDigest}}@my-alias # {{newValue}}{{else}}{{newValue}}@my-alias{{/if}}',
        },
      ]);
    });

    it('recovers the tag comment of a SHA-pinned SSH entry with an @alias', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git@github.com:owner/repo.git#${sha}@my-alias # v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          currentValue: 'v1.0.0',
          currentDigest: sha,
          replaceString: `git@github.com:owner/repo.git#${sha}@my-alias # v1.0.0`,
        },
      ]);
    });

    it('reads an @ in an HTTPS ref as part of the ref, as APM does', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - https://github.com/owner/repo.git#v1.0.0@my-alias
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          currentValue: 'v1.0.0@my-alias',
          autoReplaceStringTemplate: template,
        },
      ]);
    });

    it('skips a clone URL with no ref', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git@github.com:owner/repo.git
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'git@github.com:owner/repo.git',
          depType: 'apm',
          skipReason: 'unspecified-version',
        },
      ]);
    });

    it.each`
      entry
      ${'https://github.com#v1.0.0'}
      ${'ssh://git@host:not-a-port/owner/repo.git#v1.0.0'}
    `('marks $entry as invalid', ({ entry }) => {
      const content = codeBlock`
        dependencies:
          apm:
            - ${entry}
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: entry.slice(0, entry.indexOf('#')),
          depType: 'apm',
          currentValue: 'v1.0.0',
          skipReason: 'invalid-dependency-specification',
        },
      ]);
    });
  });

  describe('git object entries', () => {
    const template =
      '{{#if newDigest}}{{newDigest}} # {{newValue}}{{else}}{{newValue}}{{/if}}';
    const sha = '2d202c722c1815007619ee0b667401b9d42e456e';

    it.each`
      git                                              | datasource                 | packageName
      ${'owner/repo'}                                  | ${GithubTagsDatasource.id} | ${'owner/repo'}
      ${'gitlab.com/group/sub/repo'}                   | ${GitlabTagsDatasource.id} | ${'group/sub/repo'}
      ${'git@gitlab.com:group/sub/repo.git'}           | ${GitlabTagsDatasource.id} | ${'group/sub/repo'}
      ${'ssh://git@bitbucket.corp:7999/proj/repo.git'} | ${GitTagsDatasource.id}    | ${'ssh://git@bitbucket.corp:7999/proj/repo.git'}
    `(
      'looks up git: $git with $datasource',
      ({ git, datasource, packageName }) => {
        const content = codeBlock`
        dependencies:
          apm:
            - git: ${git}
              ref: v1.0.0
      `;
        expect(extractPackageFile(content, packageFile)?.deps).toEqual([
          {
            depName: git,
            depType: 'apm',
            currentValue: 'v1.0.0',
            datasource,
            packageName,
            replaceString: 'v1.0.0',
            autoReplaceStringTemplate: template,
          },
        ]);
      },
    );

    it('looks up a self-managed GitLab marked with type: gitlab', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git: https://code.acme.com/platform/standards.git
              type: gitlab
              ref: v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          datasource: GitlabTagsDatasource.id,
          packageName: 'platform/standards',
          registryUrls: ['https://code.acme.com'],
        },
      ]);
    });

    it.each`
      line                        | ref                 | replaceString         | quote
      ${'ref: ">=1.0.0 <2.0.0"'}  | ${'>=1.0.0 <2.0.0'} | ${'">=1.0.0 <2.0.0"'} | ${'"'}
      ${"ref: 'v1.0.0' # pinned"} | ${'v1.0.0'}         | ${"'v1.0.0'"}         | ${"'"}
      ${'ref: v1.0.0 # pinned'}   | ${'v1.0.0'}         | ${'v1.0.0'}           | ${''}
    `('keeps the quotes of $line', ({ line, ref, replaceString, quote }) => {
      const content = codeBlock`
        dependencies:
          apm:
            - git: owner/repo
              ${line}
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          currentValue: ref,
          replaceString,
          autoReplaceStringTemplate: `${quote}{{#if newDigest}}{{newDigest}}${quote} # {{newValue}}{{else}}{{newValue}}${quote}{{/if}}`,
        },
      ]);
    });

    it('recovers the tag of a SHA pin from the comment after it', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git: https://github.com/chrisbanes/skills.git
              ref: ${sha} #2026.8.27
              skills:
                - compose
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'https://github.com/chrisbanes/skills.git',
          depType: 'apm',
          currentValue: '2026.8.27',
          currentDigest: sha,
          datasource: GithubTagsDatasource.id,
          packageName: 'chrisbanes/skills',
          replaceString: `${sha} #2026.8.27`,
          autoReplaceStringTemplate: template,
        },
      ]);
    });

    it('recovers the tag of a quoted SHA pin', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git: owner/repo
              ref: "${sha}" # v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        {
          currentValue: 'v1.0.0',
          currentDigest: sha,
          replaceString: `"${sha}" # v1.0.0`,
        },
      ]);
    });

    it('skips a SHA pin with no tag comment', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git: owner/repo
              ref: ${sha}
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'owner/repo',
          depType: 'apm',
          currentDigest: sha,
          skipReason: 'unversioned-reference',
        },
      ]);
    });

    it('maps entries with the same ref to a line each, in order', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - ref: main
              git: owner/first
            - git: owner/second
              ref: main
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toMatchObject([
        { packageName: 'owner/first', currentValue: 'main' },
        { packageName: 'owner/second', currentValue: 'main' },
      ]);
    });

    it('skips a ref it cannot find on its own line', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - { git: owner/repo, ref: v1.0.0 }
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'owner/repo',
          depType: 'apm',
          currentValue: 'v1.0.0',
          skipReason: 'unsupported',
        },
      ]);
    });

    it('marks a git value without owner/repo as invalid', () => {
      const content = codeBlock`
        dependencies:
          apm:
            - git: foo
              ref: v1.0.0
      `;
      expect(extractPackageFile(content, packageFile)?.deps).toEqual([
        {
          depName: 'foo',
          depType: 'apm',
          currentValue: 'v1.0.0',
          skipReason: 'invalid-dependency-specification',
        },
      ]);
    });
  });
});
