import { GraphQlQueryResponse } from '@octokit/graphql/dist-types/types';
import GHub from '@octokit/rest';
import on from 'await-to-js';
import * as fs from 'fs';
import chunk from 'lodash.chunk';
import { inc, ReleaseType } from 'semver';
import { promisify } from 'util';

import { AsyncSeriesBailHook, SyncHook } from 'tapable';
import { Memoize as memoize } from 'typescript-memoize';
import {
  ICreateLabelsOptions,
  IAuthorOptions,
  GlobalOptions
} from './auto-args';
import Changelog from './changelog';
import Git from './git';
import LogParse, { ICommitAuthor, IExtendedCommit } from './log-parse';
import SEMVER, { calculateSemVerBump, IVersionLabels } from './semver';
import execPromise from './utils/exec-promise';
import { dummyLog, ILogger } from './utils/logger';
import { makeReleaseHooks } from './utils/make-hooks';
import { execSync } from 'child_process';
import {
  buildSearchQuery,
  ISearchResult,
  processQueryResult
} from './match-sha-to-pr';

export type VersionLabel =
  | SEMVER.major
  | SEMVER.minor
  | SEMVER.patch
  | 'skip'
  | 'release';

export const releaseLabels: VersionLabel[] = [
  SEMVER.major,
  SEMVER.minor,
  SEMVER.patch,
  'skip',
  'release'
];

/** Determine if a label is a label used for versioning */
export const isVersionLabel = (label: string): label is VersionLabel =>
  releaseLabels.includes(label as VersionLabel);

export type IAutoConfig = IAuthorOptions &
  GlobalOptions & {
    /** The branch that is used as the base. defaults to master */
    baseBranch: string;
    /** Branches to create prereleases from */
    prereleaseBranches: string[];
    /** Instead of publishing every PR only publish when "release" label is present */
    onlyPublishWithReleaseLabel?: boolean;
    /** Whether to prefix the version with a "v" */
    noVersionPrefix?: boolean;
    /** Plugins to initialize "auto" with */
    plugins?: (string | [string, number | boolean | string | object])[];
    /** The labels configured by the user */
    labels: ILabelDefinition[];
    /**
     * Manage old version branches.
     * Can be a true or a custom version branch prefix.
     *
     * @default 'version-'
     */
    versionBranches?: true | string;
  };

export interface ILabelDefinition {
  /** The label text */
  name: string;
  /** A title to put in the changelog for the label */
  changelogTitle?: string;
  /** The color of the label */
  color?: string;
  /** The description of the label */
  description?: string;
  /** What type of release this label signifies */
  releaseType: VersionLabel | 'none';
  /** Whether to overwrite the base label */
  overwrite?: boolean;
}

export const defaultLabels: ILabelDefinition[] = [
  {
    name: 'major',
    changelogTitle: '💥  Breaking Change',
    description: 'Increment the major version when merged',
    releaseType: SEMVER.major
  },
  {
    name: 'minor',
    changelogTitle: '🚀  Enhancement',
    description: 'Increment the minor version when merged',
    releaseType: SEMVER.minor
  },
  {
    name: 'patch',
    changelogTitle: '🐛  Bug Fix',
    description: 'Increment the patch version when merged',
    releaseType: SEMVER.patch
  },
  {
    name: 'skip-release',
    description: 'Preserve the current version when merged',
    releaseType: 'skip'
  },
  {
    name: 'release',
    description: 'Create a release when this pr is merged',
    releaseType: 'release'
  },
  {
    name: 'internal',
    changelogTitle: '🏠  Internal',
    description: 'Changes only affect the internal API',
    releaseType: 'none'
  },
  {
    name: 'documentation',
    changelogTitle: '📝  Documentation',
    description: 'Changes only affect the documentation',
    releaseType: 'none'
  }
];

/** Construct a map of label => semver label */
export const getVersionMap = (labels = defaultLabels) =>
  labels.reduce((semVer, { releaseType: type, name }) => {
    if (type && (isVersionLabel(type) || type === 'none')) {
      const list = semVer.get(type) || [];
      semVer.set(type, [...list, name]);
    }

    return semVer;
  }, new Map() as IVersionLabels);

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

export interface IReleaseHooks {
  /** This is where you hook into the changelog's hooks. This hook is exposed for convenience on during `this.hooks.onCreateRelease` and at the root `this.hooks` */
  onCreateChangelog: SyncHook<[Changelog, SEMVER | undefined]>;
  /** Control the titles in the `CHANGELOG.md` */
  createChangelogTitle: AsyncSeriesBailHook<[], string | void>;
  /** This is where you hook into the LogParse's hooks. This hook is exposed for convenience on during `this.hooks.onCreateRelease` and at the root `this.hooks` */
  onCreateLogParse: SyncHook<[LogParse]>;
}

/**
 * A class for interacting with the git remote
 */
export default class Release {
  /** Plugin entry points */
  readonly hooks: IReleaseHooks;
  /** Options Release was initialized with */
  readonly config: IAutoConfig;

  /** A class that handles interacting with git and GitHub */
  private readonly git: Git;
  /** A logger that uses log levels */
  private readonly logger: ILogger;
  /** The version bump being used during "shipit" */
  private readonly versionLabels: IVersionLabels;

  /** Initialize the release manager */
  constructor(
    git: Git,
    config: IAutoConfig = {
      baseBranch: 'master',
      prereleaseBranches: ['next'],
      labels: defaultLabels
    },
    logger: ILogger = dummyLog()
  ) {
    this.config = config;
    this.logger = logger;
    this.hooks = makeReleaseHooks();
    this.versionLabels = getVersionMap(config.labels);
    this.git = git;
  }

  /** Make the class that will generate changelogs for the project */
  @memoize()
  async makeChangelog(version?: SEMVER) {
    const project = await this.git.getProject();
    const changelog = new Changelog(this.logger, {
      owner: this.git.options.owner,
      repo: this.git.options.repo,
      baseUrl: project.html_url,
      labels: this.config.labels,
      baseBranch: this.config.baseBranch,
      prereleaseBranches: this.config.prereleaseBranches
    });

    this.hooks.onCreateChangelog.call(changelog, version);
    changelog.loadDefaultHooks();

    return changelog;
  }

  /**
   * Generate a changelog from a range of commits.
   *
   * @param from - sha or tag to start changelog from
   * @param to - sha or tag to end changelog at (defaults to HEAD)
   */
  async generateReleaseNotes(
    from: string,
    to = 'HEAD',
    version?: SEMVER
  ): Promise<string> {
    const commits = await this.getCommitsInRelease(from, to);
    const changelog = await this.makeChangelog(version);

    return changelog.generateReleaseNotes(commits);
  }

  /** Get all the commits that will be included in a release */
  async getCommitsInRelease(from: string, to = 'HEAD') {
    const allCommits = await this.getCommits(from, to);
    const allPrCommits = await Promise.all(
      allCommits
        .filter(commit => commit.pullRequest)
        .map(async commit => {
          const [err, commits = []] = await on(
            this.git.getCommitsForPR(Number(commit.pullRequest!.number))
          );
          return err ? [] : commits;
        })
    );
    const allPrCommitHashes = allPrCommits
      .filter(Boolean)
      .reduce(
        (all, pr) => [...all, ...pr.map(subCommit => subCommit.sha)],
        [] as string[]
      );

    const uniqueCommits = allCommits.filter(
      commit =>
        (commit.pullRequest || !allPrCommitHashes.includes(commit.hash)) &&
        !commit.subject.includes('[skip ci]')
    );

    const commitsWithoutPR = uniqueCommits.filter(
      commit => !commit.pullRequest
    );
    const batches = chunk(commitsWithoutPR, 10);

    const queries = await Promise.all(
      batches
        .map(batch =>
          buildSearchQuery(
            this.git.options.owner,
            this.git.options.repo,
            batch.map(c => c.hash)
          )
        )
        .filter((q): q is string => Boolean(q))
        .map(q => this.git.graphql(q))
    );
    const data = queries.filter((q): q is GraphQlQueryResponse => Boolean(q));

    if (!data.length) {
      return uniqueCommits;
    }

    const commitsInRelease: (IExtendedCommit | undefined)[] = [
      ...uniqueCommits
    ];
    const logParse = await this.createLogParse();

    Promise.all(
      data.map(results =>
        Object.entries(results)
          .filter((result): result is [string, ISearchResult] =>
            Boolean(result[1])
          )
          .map(([key, result]) =>
            processQueryResult(key, result, commitsWithoutPR)
          )
          .filter((commit): commit is IExtendedCommit => Boolean(commit))
          .map(async commit => {
            const index = commitsWithoutPR.findIndex(
              commitWithoutPR => commitWithoutPR.hash === commit.hash
            );

            commitsInRelease[index] = await logParse.normalizeCommit(commit);
          })
      )
    );

    return commitsInRelease.filter((commit): commit is IExtendedCommit =>
      Boolean(commit)
    );
  }

  /** Update a changelog with a new set of release notes */
  async updateChangelogFile(
    title: string,
    releaseNotes: string,
    changelogPath: string
  ) {
    const date = new Date().toDateString();
    let newChangelog = '#';

    if (title) {
      newChangelog += ` ${title}`;
    }

    newChangelog += ` (${date})\n\n${releaseNotes}`;

    if (fs.existsSync(changelogPath)) {
      this.logger.verbose.info('Old changelog exists, prepending changes.');
      const oldChangelog = await readFile(changelogPath, 'utf8');
      newChangelog = `${newChangelog}\n\n---\n\n${oldChangelog}`;
    }

    await writeFile(changelogPath, newChangelog);
    this.logger.verbose.info('Wrote new changelog to filesystem.');
    await execPromise('git', ['add', changelogPath]);
  }

  /**
   * Prepend a set of release notes to the changelog.md
   *
   * @param releaseNotes - Release notes to prepend to the changelog
   * @param lastRelease - Last release version of the code. Could be the first commit SHA
   * @param currentVersion - Current version of the code
   */
  async addToChangelog(
    releaseNotes: string,
    lastRelease: string,
    currentVersion: string
  ) {
    this.hooks.createChangelogTitle.tapPromise('Default', async () => {
      let version;

      if (lastRelease.match(/\d+\.\d+\.\d+/)) {
        version = await this.calcNextVersion(lastRelease);
      } else {
        // lastRelease is a git sha. no releases have been made
        const bump = await this.getSemverBump(lastRelease);
        version = inc(currentVersion, bump as ReleaseType);
      }

      this.logger.verbose.info('Calculated next version to be:', version);

      if (!version) {
        return '';
      }

      return this.config.noVersionPrefix || version.startsWith('v')
        ? version
        : `v${version}`;
    });

    this.logger.verbose.info('Adding new changes to changelog.');
    const title = await this.hooks.createChangelogTitle.promise();

    await this.updateChangelogFile(title || '', releaseNotes, 'CHANGELOG.md');
  }

  /**
   * Get a range of commits. The commits will have PR numbers and labels attached
   *
   * @param from - Tag or SHA to start at
   * @param to - Tag or SHA to end at (defaults to HEAD)
   */
  async getCommits(from: string, to = 'HEAD'): Promise<IExtendedCommit[]> {
    this.logger.verbose.info(`Getting commits from ${from} to ${to}`);

    const gitlog = await this.git.getGitLog(from, to);

    this.logger.veryVerbose.info('Got gitlog:\n', gitlog);

    const logParse = await this.createLogParse();
    const commits = (await logParse.normalizeCommits(gitlog)).filter(commit => {
      // 0 exit code means that the commit is an ancestor of "from"
      // and should not be released
      const released =
        execSync(
          `git merge-base --is-ancestor ${commit.hash} ${from}; echo $?`,
          {
            encoding: 'utf8'
          }
        ).trim() === '0';

      if (released) {
        this.logger.verbose.warn(
          `Commit already released omitting: "${commit.hash.slice(
            0,
            8
          )}" with message "${commit.subject}"`
        );
      }

      return !released;
    });

    this.logger.veryVerbose.info('Added labels to commits:\n', commits);

    return commits;
  }

  /** Go through the configured labels and either add them to the project or update them */
  async addLabelsToProject(
    labels: ILabelDefinition[],
    options: ICreateLabelsOptions = {}
  ) {
    const oldLabels = ((await this.git.getProjectLabels()) || []).map(l =>
      l.toLowerCase()
    );
    const labelsToCreate = labels.filter(label => {
      if (
        label.releaseType === 'release' &&
        !this.config.onlyPublishWithReleaseLabel
      ) {
        return false;
      }

      if (
        label.releaseType === 'skip' &&
        this.config.onlyPublishWithReleaseLabel
      ) {
        return false;
      }

      return true;
    });

    if (!options.dryRun) {
      await Promise.all(
        labelsToCreate.map(async label => {
          if (oldLabels.some(o => label.name.toLowerCase() === o)) {
            return this.git.updateLabel(label);
          }

          return this.git.createLabel(label);
        })
      );
    }

    const repoMetadata = await this.git.getProject();
    const justLabelNames = labelsToCreate.reduce<string[]>(
      (acc, label) => [...acc, label.name],
      []
    );

    if (justLabelNames.length > 0) {
      const state = options.dryRun ? 'Would have created' : 'Created';
      this.logger.log.log(`${state} labels: ${justLabelNames.join(', ')}`);
    } else {
      const state = options.dryRun ? 'would have been' : 'were';
      this.logger.log.log(
        `No labels ${state} created, they must have already been present on your project.`
      );
    }

    if (options.dryRun) {
      return;
    }

    this.logger.log.log(
      `\nYou can see these, and more at ${repoMetadata.html_url}/labels`
    );
  }

  /**
   * Calculate the SEMVER bump over a range of commits using the PR labels
   *
   * @param from - Tag or SHA to start at
   * @param to - Tag or SHA to end at (defaults to HEAD)
   */
  async getSemverBump(from: string, to = 'HEAD'): Promise<SEMVER> {
    const commits = await this.getCommits(from, to);
    const labels = commits.map(commit => commit.labels);
    const { onlyPublishWithReleaseLabel } = this.config;
    const options = { onlyPublishWithReleaseLabel };

    this.logger.verbose.info('Calculating SEMVER bump using:\n', {
      labels,
      versionLabels: this.versionLabels,
      options
    });

    const result = calculateSemVerBump(labels, this.versionLabels, options);

    this.logger.verbose.success('Calculated SEMVER bump:', result);

    return result;
  }

  /** Given a tag get the next incremented version */
  async calcNextVersion(lastTag: string) {
    const bump = await this.getSemverBump(lastTag);
    return inc(lastTag, bump as ReleaseType);
  }

  /** Create the class that will parse the log for PR info */
  @memoize()
  private async createLogParse() {
    const logParse = new LogParse();

    logParse.hooks.parseCommit.tapPromise('Author Info', async commit =>
      this.attachAuthor(commit)
    );
    logParse.hooks.parseCommit.tapPromise('PR Information', async commit =>
      this.addPrInfoToCommit(commit)
    );
    logParse.hooks.parseCommit.tapPromise('PR Commits', async commit => {
      const prsSinceLastRelease = await this.getPRsSinceLastRelease();
      return this.getPRForRebasedCommits(commit, prsSinceLastRelease);
    });

    this.hooks.onCreateLogParse.call(logParse);

    return logParse;
  }

  /** Get a the PRs that have been merged since the last GitHub release. */
  @memoize()
  private async getPRsSinceLastRelease() {
    let lastRelease: {
      /** Date the last release was published */
      published_at: string;
    };

    try {
      lastRelease = await this.git.getLatestReleaseInfo();
    } catch (error) {
      const firstCommit = await this.git.getFirstCommit();

      lastRelease = {
        published_at: await this.git.getCommitDate(firstCommit)
      };
    }

    if (!lastRelease) {
      return [];
    }

    const prsSinceLastRelease = await this.git.searchRepo({
      q: `is:pr is:merged merged:>=${lastRelease.published_at}`
    });

    if (!prsSinceLastRelease || !prsSinceLastRelease.items) {
      return [];
    }

    const data = await Promise.all(
      prsSinceLastRelease.items.map(
        async (pr: {
          /** The issue number of the pull request */
          number: number;
        }) => this.git.getPullRequest(Number(pr.number))
      )
    );

    return data.map(item => item.data);
  }

  /**
   * Add the PR info (labels and body) to the commit
   *
   * @param commit - Commit to modify
   */
  private async addPrInfoToCommit(commit: IExtendedCommit) {
    const modifiedCommit = { ...commit };

    if (!modifiedCommit.labels) {
      modifiedCommit.labels = [];
    }

    if (modifiedCommit.pullRequest) {
      const [err, info] = await on(
        this.git.getPr(modifiedCommit.pullRequest.number)
      );

      if (err || !info || !info.data) {
        return modifiedCommit;
      }

      const labels = info ? info.data.labels.map(l => l.name) : [];
      modifiedCommit.labels = [
        ...new Set([...labels, ...modifiedCommit.labels])
      ];
      modifiedCommit.pullRequest.body = info.data.body;
      const hasPrOpener = modifiedCommit.authors.find(
        author => author.username === info.data.user.login
      );

      // If we can't find the use who opened the PR in authors attempt
      // to add that user.
      if (!hasPrOpener) {
        const user = await this.git.getUserByUsername(info.data.user.login);

        if (user) {
          modifiedCommit.authors.push({ ...user, username: user.login });
        }
      }
    }

    return modifiedCommit;
  }

  /**
   * Commits from rebased PRs do not have messages that tie them to a PR
   * Instead we have to find all PRs since the last release and try to match
   * their merge commit SHAs.
   */
  private getPRForRebasedCommits(
    commit: IExtendedCommit,
    pullRequests: GHub.PullsGetResponse[]
  ) {
    const matchPr = pullRequests.find(
      pr => pr.merge_commit_sha === commit.hash
    );

    if (!commit.pullRequest && matchPr) {
      const labels = matchPr.labels.map(label => label.name) || [];
      commit.labels = [...new Set([...labels, ...commit.labels])];
      commit.pullRequest = {
        number: matchPr.number
      };
    }

    return commit;
  }

  /** Parse the commit for information about the author and any other author that might have helped. */
  private async attachAuthor(commit: IExtendedCommit) {
    const modifiedCommit = { ...commit };
    let resolvedAuthors: (
      | (ICommitAuthor & {
          /** The GitHub user name of the git committer */
          login?: string;
        })
      | Partial<GHub.UsersGetByUsernameResponse>
    )[] = [];

    // If there is a pull request we will attempt to get the authors
    // from any commit in the PR
    if (modifiedCommit.pullRequest) {
      const [prCommitsErr, prCommits] = await on(
        this.git.getCommitsForPR(Number(modifiedCommit.pullRequest.number))
      );

      if (prCommitsErr || !prCommits) {
        return commit;
      }

      resolvedAuthors = await Promise.all(
        prCommits.map(async prCommit => {
          if (!prCommit.author) {
            return prCommit.commit.author;
          }

          return {
            ...prCommit.author,
            ...(await this.git.getUserByUsername(prCommit.author.login)),
            hash: prCommit.sha
          };
        })
      );
    } else {
      const [, response] = await on(this.git.getCommit(commit.hash));

      if (response?.data?.author?.login) {
        const username = response.data.author.login;
        const author = await this.git.getUserByUsername(username);

        resolvedAuthors.push({
          name: commit.authorName,
          email: commit.authorEmail,
          ...author,
          hash: commit.hash
        });
      } else if (commit.authorEmail) {
        const author = await this.git.getUserByEmail(commit.authorEmail);

        resolvedAuthors.push({
          email: commit.authorEmail,
          name: commit.authorName,
          ...author,
          hash: commit.hash
        });
      }
    }

    modifiedCommit.authors = resolvedAuthors.map(author => ({
      ...author,
      ...(author && 'login' in author ? { username: author.login } : {})
    }));

    modifiedCommit.authors.forEach(author => {
      this.logger.veryVerbose.info(
        `Found author: ${author.username} ${author.email} ${author.name}`
      );
    });

    return modifiedCommit;
  }
}
