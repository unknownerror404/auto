import { Auto, IPlugin, execPromise } from '@auto-it/core';
import { IExtendedCommit } from '@auto-it/core/src/log-parse'

import path from 'path'
import fs from 'fs';
import {promisify} from 'util';
import { inc, ReleaseType } from 'semver'

/** Global functions for usage in module */
const { parse } = require('dot-properties')
const readFile = promisify(fs.readFile)
const logPrefix = '[Gradle-Release-Plugin]'

export interface IGradleReleasePluginPluginOptions {
  /** The file that contains the version string in it. */
  versionFile: string;

  /** The command to build the project with */
  gradleCommand: string;
}

/** getPre does this */
async function getPreviousVersion(auto: Auto, path: string) : Promise<string> {
  const data = await readFile(path, 'utf-8');
  const props = parse(data)
  if (props) {
    return props.version
  }

  throw new Error('No version was found inside version-file.')
}

/**  */
export default class GradleReleasePluginPlugin implements IPlugin {
  /** The name of the plugin */
  name = 'Gradle Release Plugin';

  /** The options of the plugin */
  readonly options: IGradleReleasePluginPluginOptions;

  /** Previous Version */
  previousVersion = '';
  
  /** Version to Release */
  newVersion = '';

  /** Initialize the plugin with it's options */
  constructor(options: IGradleReleasePluginPluginOptions) {
    this.options = {
      versionFile: path.join(process.cwd(), options.versionFile || './gradle.properties'),
      gradleCommand: options?.gradleCommand ? path.join(process.cwd(), options.gradleCommand) : '/usr/bin/gradle',
    };
  }

  /** Injection version values into string command(s) */
  // injectVersions

  /** Tap into auto plugin points. */
  apply(auto: Auto) {
    auto.hooks.beforeRun.tap(this.name, () => {
      auto.logger.log.warn(`${logPrefix} BeforeRun`);
      
      // validation
      if (!fs.existsSync(this.options.versionFile)) {
        auto.logger.log.warn(`${logPrefix} The version-file does not exist on disk.`);
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
      return getPreviousVersion(auto, this.options.versionFile);
    });

    auto.hooks.version.tapPromise(this.name, async (version: string) => {
      this.previousVersion = await getPreviousVersion(auto, this.options.versionFile);
      this.newVersion = inc(this.previousVersion, version as ReleaseType) || '';
      if (!this.newVersion) {
        throw new Error(
          `Could not increment previous version: ${this.previousVersion}`
        );
      }

      await execPromise(this.options.gradleCommand, [
        'release',
        '-Prelease.useAutomaticVersion=true',
        `-Prelease.releaseVersion=${this.previousVersion}`,
        `-Prelease.newVersion=${this.newVersion}`,
        '-x createReleaseTag',
        '-x preTagCommit',
        '-x commitNewVersion'
      ])

      await execPromise('git', ['add', 'gradle.properties']) 
      await execPromise('git', ['commit', '-m',
        `"Bump version to: ${this.newVersion} [skip ci]"`,
        '--no-verify'
      ])

      await execPromise('git', [
        'push',
        '--follow-tags',
        '--set-upstream',
        'origin',
        auto.baseBranch
      ]);
    });
  }
}
