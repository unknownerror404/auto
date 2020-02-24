import { Auto, IPlugin, execPromise } from '@auto-it/core';
import { IExtendedCommit } from '@auto-it/core/dist/log-parse';

import path from 'path';
import fs from 'fs-extra';
import { inc, ReleaseType } from 'semver';
import { parse } from 'dot-properties';

/** Global functions for usage in module */
const logPrefix = '[Gradle-Release-Plugin]';

export interface IVersionOptions {
  /** When this option is true, only the version code will be bumped */
  bumpVersionCodeOnly?: boolean;

  /** Don't tag the commit or create a release */
  noTag?: boolean;
}

export interface IGradleReleasePluginPluginOptions {
  /** The file that contains the version string in it. */
  versionFile?: string;

  /** The gradle binary to release the project with */
  gradleCommand?: string;

  /** A list of gradle command customizations to pass to gradle */
  gradleOptions?: Array<string>;

  /** */
  versionOptions?: Required<IVersionOptions>;
 
  /** Tagging by default, but can be turned off */

}

interface IGradleProperties {
  /** A string that represents the version code */
  versionCode?: string;
  /** A string that represents the version name or public version */
  versionName: string;
}

/** Retrieves a previous version from gradle.properties */
async function getPreviousVersion(path: string): Promise<IGradleProperties> {
  try {
    const data = await fs.readFile(path, 'utf-8');
    const { version, versionCode } = parse(data);

    if (version && versionCode) {
      return {
        versionCode: versionCode,
        versionName: version
      }
    }
  } catch (error) {}

  throw new Error('No version was found inside version-file.');
}

/** A plugin to release java projects with gradle */
export default class GradleReleasePluginPlugin implements IPlugin {
  /** The name of the plugin */
  name = 'Gradle Release Plugin';

  /** The options of the plugin */
  readonly options: Required<IGradleReleasePluginPluginOptions>;

  /** Initialize the plugin with it's options */
  constructor(options: IGradleReleasePluginPluginOptions = {}) {
    this.options = {
      versionFile: options?.versionFile
        ? path.join(process.cwd(), options.versionFile)
        : path.join(process.cwd(), './gradle.properties'),
      gradleCommand: options?.gradleCommand
        ? path.join(process.cwd(), options.gradleCommand)
        : '/usr/bin/gradle',
      gradleOptions: options.gradleOptions || [],
      versionOptions: options.versionOptions || { bumpVersionCodeOnly: false, noTag: false }
    };
  }

  /** Tap into auto plugin points. */
  apply(auto: Auto) {
    auto.hooks.beforeRun.tap(this.name, () => {
      auto.logger.log.warn(`${logPrefix} BeforeRun`);
      // validation
      if (!fs.existsSync(this.options.versionFile)) {
        auto.logger.log.error(
          `${logPrefix} The version-file does not exist on disk.`
        );
        process.exit(1)
      }
    });

    auto.hooks.onCreateLogParse.tap(this.name, logParse => {
      logParse.hooks.omitCommit.tap(this.name, (commit: IExtendedCommit) => {
        if (commit.subject.includes('[Gradle Release Plugin]')) {
          return true;
        }
      });
    });

    auto.hooks.getPreviousVersion.tapPromise(this.name, () => {
      return getPreviousVersion(this.options.versionFile).then(props => {
        return props.versionName
      });
    });

    auto.hooks.version.tapPromise(this.name, async (version: string) => {
      const {versionName, versionCode} = await getPreviousVersion(
        this.options.versionFile
      );
      auto.logger.log.info(`Found Version Name=[${version}] Version Code=[${versionCode}]`);

      const newVersion = inc(versionName, version as ReleaseType) || '';
      if (!newVersion) {
        throw new Error(
          `Could not increment previous version: ${versionName}`
        );
      }

      // default -- run if normal bumping is on versus internal code bump only
      if (this.options.versionOptions.bumpVersionCodeOnly) {
        auto.logger.log.info('Bumping Version Code')

      } else {
        auto.logger.log.info('Bumping Version Name & Version Code')
        await execPromise(this.options.gradleCommand, [
          'release',
          '-Prelease.useAutomaticVersion=true',
          `-Prelease.releaseVersion=${versionName}`,
          `-Prelease.newVersion=${newVersion}`,
          '-x createReleaseTag',
          '-x preTagCommit',
          '-x commitNewVersion',
          ...this.options.gradleOptions
        ]);
      }

      await execPromise('git', ['add', 'gradle.properties']);
      await execPromise('git', [
        'commit',
        '-m',
        `"Bump version to: ${newVersion} [skip ci]"`,
        '--no-verify'
      ]);

      await execPromise('git', [
        'push',
        '--follow-tags',
        '--set-upstream',
        auto.remote,
        auto.baseBranch
      ]);
    });
  }
}
