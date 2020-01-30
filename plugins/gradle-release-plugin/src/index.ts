import { Auto, IPlugin, execPromise } from '@auto-it/core';
// import parseGitHubUrl from 'parse-github-url';
// import path from 'path'
import fs from 'fs';
import {promisify} from 'util';
import * as path from 'path';
import { inc, ReleaseType } from 'semver'

/** Global functions for usage in module */
const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)
const updateFile = promisify(updateVersionFile)
const logPrefix = '[Gradle-Release-Plugin]'
// const versionRegex = /version=(\d).(\d).(\d)(-SNAPSHOT)*?$/;

export interface IGradleReleasePluginPluginOptions {
  /** The file that contains the version string in it. */
  versionFile: string;

  /** The command to build the project with */
  gradleCommand: string;

  /** An list of options to pass to gradle */
  gradleOptions: string;
}

/** Get the previous version from the the file that has the version */
async function getPreviousVersion(auto: Auto, path: string) : Promise<string> {
  let versionProperties;
  const data = await readFile(path, 'utf-8');

  versionProperties = JSON.parse(data);
  if (versionProperties) {
    if ('version' in versionProperties) {
      return versionProperties.version;
    }
  }
  throw new Error('No version was found inside version-file.')
}

/** Update the version file by writing the new version.  It will then be checked in. */
async function updateVersionFile(auto: Auto, filepath: string, newVersion: string) {
  await writeFile(filepath, `{"version": "${newVersion}"}`, {"encoding": 'utf-8'})
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
      versionFile: path.join(process.cwd(), options.versionFile || './version.json'),
      gradleCommand: path.join(process.cwd(), options.gradleCommand) || '/usr/bin/gradle',
      gradleOptions: ''.concat('-x createReleaseTag  -x updateVersion -x commitNewVersion', options.gradleOptions)
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

      // Secrets
      auto.checkEnv(this.name, 'CLIENT_ID');
      auto.checkEnv(this.name, 'CLIENT_SECRET');
      auto.checkEnv(this.name, 'REFRESH_TOKEN'); 
    });

    auto.hooks.getPreviousVersion.tapPromise(this.name, () => {
      return getPreviousVersion(auto, this.options.versionFile);
    });

    auto.hooks.version.tapPromise(this.name, async (version: string) => {
      this.previousVersion = await getPreviousVersion(auto, this.options.versionFile);
      
      // eslint-disable-next-line
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
        this.options.gradleOptions
      ]);

      await updateFile(auto, this.options.versionFile, this.newVersion);

      await execPromise('git', [
        `-am "Bump to version to: ${this.newVersion}" [skip ci]`,
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
