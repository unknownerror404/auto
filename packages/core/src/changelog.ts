import { AsyncSeriesBailHook, AsyncSeriesWaterfallHook } from 'tapable';
import { URL } from 'url';
import join from 'url-join';

import { ICommitAuthor, IExtendedCommit } from './log-parse';
import { ILabelDefinition } from './release';
import { ILogger } from './utils/logger';
import { makeChangelogHooks } from './utils/make-hooks';
import SEMVER from './semver';

export interface IGenerateReleaseNotesOptions {
  /** Github repo owner (user) */
  owner: string;
  /** GitHub project to operate on */
  repo: string;
  /** The URL to the GitHub (public or enterprise) the project is using */
  baseUrl: string;
  /** The labels configured by the user */
  labels: ILabelDefinition[];
  /** The branch that is used as the base. defaults to master */
  baseBranch: string;
  /** The branches that is used as prerelease branches. defaults to next */
  prereleaseBranches: string[];
}

interface ICommitSplit {
  [key: string]: IExtendedCommit[];
}

export interface IChangelogHooks {
  /** Change how the changelog renders lines. */
  renderChangelogLine: AsyncSeriesWaterfallHook<[[IExtendedCommit, string]]>;
  /** Change how the changelog renders titles */
  renderChangelogTitle: AsyncSeriesBailHook<
    [string, { [label: string]: string }],
    string | void
  >;
  /** Change how the changelog renders authors. This is both the author on each commit note and the user in the author section (the part between parentheses). This is generally a link to some profile. */
  renderChangelogAuthor: AsyncSeriesBailHook<
    [ICommitAuthor, IExtendedCommit, IGenerateReleaseNotesOptions],
    string | void
  >;
  /** Change how the changelog renders authors in the authors section. The hook provides the author object and the user created with `renderChangelogAuthor`. Here is where you might display extra info about the author, such as their full name. */
  renderChangelogAuthorLine: AsyncSeriesBailHook<
    [ICommitAuthor, string],
    string | void
  >;
  /**
   * Add extra content to your changelogs. This hook provide
   * all the current "extra" notes and all of the commits for
   * the changelog.
   */
  addToBody: AsyncSeriesWaterfallHook<[string[], IExtendedCommit[]]>;
  /** Control what commits effect the additional release notes section. */
  omitReleaseNotes: AsyncSeriesBailHook<[IExtendedCommit], boolean | void>;
}

/** Determine how deep the markdown headers are in a string */
const getHeaderDepth = (line: string) =>
  line.split('').reduce((count, char) => (char === '#' ? count + 1 : count), 0);

/** Filter for only commits that have a specific label */
const filterLabel = (commits: IExtendedCommit[], label: string) =>
  commits.filter(commit => commit.labels.includes(label));

/**
 * Manages creating the "Release Notes" that are included in
 * both the CHANGELOG.md and GitHub releases.
 */
export default class Changelog {
  /** Plugin entry points */
  readonly hooks: IChangelogHooks;
  /** The options the changelog was initialized with */
  readonly options: IGenerateReleaseNotesOptions;

  /** The authors in the current changelog */
  private authors?: [IExtendedCommit, ICommitAuthor][];
  /** A logger that uses log levels */
  private readonly logger: ILogger;

  /** Initialize the changelog generator with default hooks and labels */
  constructor(logger: ILogger, options: IGenerateReleaseNotesOptions) {
    this.logger = logger;
    this.options = options;
    this.hooks = makeChangelogHooks();

    if (!this.options.labels.find(l => l.name === 'pushToBaseBranch'))
      this.options.labels.push({
        name: 'pushToBaseBranch',
        changelogTitle: `⚠️  Pushed to ${options.baseBranch}`,
        description: 'N/A',
        releaseType: SEMVER.patch
      });
  }

  /** Load the default configuration */
  loadDefaultHooks() {
    this.hooks.renderChangelogAuthor.tap('Default', (author, commit) =>
      this.createUserLink(author, commit)
    );
    this.hooks.renderChangelogAuthorLine.tap('Default', (author, user) => {
      const authorString =
        author.name && user ? `${author.name} (${user})` : user;
      return authorString ? `- ${authorString}` : undefined;
    });
    this.hooks.renderChangelogLine.tap('Default', ([commit, line]) => [
      commit,
      line
    ]);
    this.hooks.renderChangelogTitle.tap(
      'Default',
      (label, changelogTitles) => `#### ${changelogTitles[label]}\n`
    );
    this.hooks.omitReleaseNotes.tap('Renovate', commit => {
      const names = ['renovate-pro[bot]', 'renovate-bot'];

      if (
        commit.authors.find(author =>
          Boolean(
            (author.name && names.includes(author.name)) ||
              (author.username && names.includes(author.username))
          )
        )
      ) {
        return true;
      }
    });
  }

  /** Generate the release notes for a group of commits */
  async generateReleaseNotes(commits: IExtendedCommit[]): Promise<string> {
    if (commits.length === 0) {
      return '';
    }

    this.logger.verbose.info('Generating release notes for:\n', commits);
    const split = this.splitCommits(commits);
    this.logger.verbose.info('Split commits into groups');
    this.logger.veryVerbose.info('\n', split);

    const sections: string[] = [];

    const extraNotes = (await this.hooks.addToBody.promise([], commits)) || [];
    extraNotes.filter(Boolean).forEach(note => sections.push(note));

    await this.createReleaseNotesSection(commits, sections);
    this.logger.verbose.info('Added release notes to changelog');

    this.authors = this.getAllAuthors(split);
    await this.createLabelSection(split, sections);
    this.logger.verbose.info('Added groups to changelog');

    await this.createAuthorSection(sections);
    this.logger.verbose.info('Added authors to changelog');

    const result = sections.join('\n\n');
    this.logger.verbose.info('Successfully generated release notes.');

    return result;
  }

  /** Create a link to a user for use in the changelog */
  createUserLink(author: ICommitAuthor, commit: IExtendedCommit) {
    const githubUrl = new URL(this.options.baseUrl).origin;

    if (author.username === 'invalid-email-address') {
      return;
    }

    return author.username
      ? `[@${author.username}](${join(githubUrl, author.username)})`
      : author.email || commit.authorEmail;
  }

  /** Split commits into changelogTitle sections. */
  private splitCommits(commits: IExtendedCommit[]): ICommitSplit {
    let currentCommits = [...commits];
    const order = ['major', 'minor', 'patch'];
    const sections = this.options.labels
      .filter(label => label.changelogTitle)
      .sort((a, b) => {
        const bIndex =
          order.indexOf(b.releaseType || '') + 1 || order.length + 1;
        const aIndex =
          order.indexOf(a.releaseType || '') + 1 || order.length + 1;
        return aIndex - bIndex;
      })
      .reduce<ILabelDefinition[]>((acc, item) => [...acc, item], []);

    const defaultPatchLabelName = this.getFirstLabelNameFromLabelKey(
      this.options.labels,
      'patch'
    );

    commits
      .filter(
        ({ labels }) =>
          // in case pr commit doesn't contain a label for section inclusion
          !sections.some(section => labels.includes(section.name)) ||
          // in this case we auto attached a patch when it was merged
          (labels[0] === 'released' && labels.length === 1)
      )
      .map(({ labels }) => labels.push(defaultPatchLabelName));

    return Object.assign(
      {},
      ...sections.map(label => {
        const matchedCommits = filterLabel(currentCommits, label.name);
        currentCommits = currentCommits.filter(
          commit => !matchedCommits.includes(commit)
        );

        return matchedCommits.length === 0
          ? {}
          : { [label.name]: matchedCommits };
      })
    );
  }

  /** Get the default label for a label key */
  private getFirstLabelNameFromLabelKey(
    labels: ILabelDefinition[],
    labelKey: string
  ) {
    return labels.find(l => l.releaseType === labelKey)?.name || labelKey;
  }

  /** Create a list of users */
  private async createUserLinkList(commit: IExtendedCommit) {
    const result = new Set<string>();

    await Promise.all(
      commit.authors.map(async rawAuthor => {
        const data = (this.authors!.find(
          ([, commitAuthor]) =>
            (commitAuthor.name &&
              rawAuthor.name &&
              commitAuthor.name === rawAuthor.name) ||
            (commitAuthor.email &&
              rawAuthor.email &&
              commitAuthor.email === rawAuthor.email) ||
            (commitAuthor.username &&
              rawAuthor.username &&
              commitAuthor.username === rawAuthor.username)
        ) as [IExtendedCommit, ICommitAuthor]) || [{}, rawAuthor];

        const link = await this.hooks.renderChangelogAuthor.promise(
          data[1],
          commit,
          this.options
        );

        if (link) {
          result.add(link);
        }
      })
    );

    return [...result].join(' ');
  }

  /** Transform a commit into a line in the changelog */
  private async generateCommitNote(commit: IExtendedCommit) {
    const subject = commit.subject ? commit.subject.trim() : '';
    let pr = '';

    if (commit.pullRequest?.number) {
      const prLink = join(
        this.options.baseUrl,
        'pull',
        commit.pullRequest.number.toString()
      );
      pr = `[#${commit.pullRequest.number}](${prLink})`;
    }

    const user = await this.createUserLinkList(commit);
    return `- ${subject} ${pr}${user ? ` (${user})` : ''}`;
  }

  /** Get all the authors in the provided commits */
  private getAllAuthors(split: ICommitSplit) {
    const commits = Object.values(split).reduce(
      (
        labeledCommits: IExtendedCommit[],
        sectionCommits: IExtendedCommit[]
      ) => [...labeledCommits, ...sectionCommits],
      []
    );

    return commits
      .map(commit =>
        commit.authors
          .filter(
            author =>
              author.username !== 'invalid-email-address' &&
              (author.name || author.email || author.username)
          )
          .map(author => [commit, author] as [IExtendedCommit, ICommitAuthor])
      )
      .reduce((all, more) => [...all, ...more], [])
      .sort(a => ('id' in a[1] ? 0 : 1));
  }

  /** Create a section in the changelog to showcase contributing authors */
  private async createAuthorSection(sections: string[]) {
    const authors = new Set<string>();
    const authorsWithFullData = this.authors!.map(
      ([, author]) => author
    ).filter(author => 'id' in author);

    await Promise.all(
      this.authors!.map(async ([commit, author]) => {
        const info =
          authorsWithFullData.find(
            u =>
              (author.name && u.name === author.name) ||
              (author.email && u.email === author.email)
          ) || author;
        const user = await this.hooks.renderChangelogAuthor.promise(
          info,
          commit,
          this.options
        );
        const authorEntry = await this.hooks.renderChangelogAuthorLine.promise(
          info,
          user as string
        );

        if (authorEntry && !authors.has(authorEntry)) {
          authors.add(authorEntry);
        }
      })
    );

    if (authors.size === 0) {
      return;
    }

    let authorSection = `#### Authors: ${authors.size}\n\n`;
    authorSection += [...authors].sort((a, b) => a.localeCompare(b)).join('\n');
    sections.push(authorSection);
  }

  /** Create a section in the changelog to with all of the changelog notes organized by change type */
  private async createLabelSection(split: ICommitSplit, sections: string[]) {
    const changelogTitles = this.options.labels.reduce((titles, label) => {
      if (label.changelogTitle) {
        titles[label.name] = label.changelogTitle;
      }

      return titles;
    }, {} as { [label: string]: string });

    const labelSections = await Promise.all(
      Object.entries(split).map(async ([label, labelCommits]) => {
        const title = await this.hooks.renderChangelogTitle.promise(
          label,
          changelogTitles
        );

        const lines = new Set<string>();

        await Promise.all(
          labelCommits.map(async commit => {
            const base = commit.pullRequest?.base || '';
            const branch = base.includes('/') ? base.split('/')[1] : base;

            // We want to keep the release notes for a prerelease branch but
            // omit the changelog item
            if (branch && this.options.prereleaseBranches.includes(branch)) {
              return true;
            }

            const [, line] = await this.hooks.renderChangelogLine.promise([
              commit,
              await this.generateCommitNote(commit)
            ]);

            lines.add(line);
          })
        );

        return [
          title as string,
          [...lines].sort((a, b) => a.split('\n').length - b.split('\n').length)
        ] as [string, string[]];
      })
    );

    const mergedSections = labelSections.reduce(
      (acc, [title, commits]) => ({
        ...acc,
        [title]: [...(acc[title] || []), ...commits]
      }),
      {} as Record<string, string[]>
    );

    Object.entries(mergedSections)
      .map(([title, lines]) => [title, ...lines].join('\n'))
      .map(section => sections.push(section));
  }

  /** Gather extra release notes to display at the top of the changelog */
  private async createReleaseNotesSection(
    commits: IExtendedCommit[],
    sections: string[]
  ) {
    if (!commits.length) {
      return;
    }

    let section = '';
    const visited = new Set<number>();
    const included = await Promise.all(
      commits.map(async commit => {
        const omit = await this.hooks.omitReleaseNotes.promise(commit);

        if (!omit) {
          return commit;
        }
      })
    );

    included.forEach(commit => {
      if (!commit) {
        return;
      }

      const pr = commit.pullRequest;

      if (!pr || !pr.body) {
        return;
      }

      const title = /^[#]{0,5}[ ]*[R|r]elease [N|n]otes$/;
      const lines = pr.body.split('\n').map(line => line.replace(/\r$/, ''));
      const notesStart = lines.findIndex(line => Boolean(line.match(title)));

      if (notesStart === -1 || visited.has(pr.number)) {
        return;
      }

      const depth = getHeaderDepth(lines[notesStart]);
      visited.add(pr.number);
      let notes = '';

      for (let index = notesStart; index < lines.length; index++) {
        const line = lines[index];
        const isTitle = line.match(title);

        if (line.startsWith('#') && getHeaderDepth(line) <= depth && !isTitle) {
          break;
        }

        if (!isTitle) {
          notes += `${line}\n`;
        }
      }

      section += `_From #${pr.number}_\n\n${notes.trim()}\n\n`;
    });

    if (!section) {
      return;
    }

    sections.push(`### Release Notes\n\n${section}---`);
  }
}
