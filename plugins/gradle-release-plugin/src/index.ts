import { Auto, IPlugin, execPromise } from '@auto-it/core';
// import parseGitHubUrl from 'parse-github-url';
// import path from 'path'
import fs from 'fs';
import { inc, ReleaseType } from 'semver'

/** Global functions for usage in module */
// const readFile = promisify(fs.readFile);
// const writeFile = promisify(fs.writeFile);

/** Constants */
const logPrefix = '[Gradle-Release-Plugin]';
// const versionRegex = /version=(\d).(\d).(\d)(-SNAPSHOT)*?$/;

export interface IGradleReleasePluginPluginOptions {
  /** The file that contains the version string in it. */
  versionFile: string;

  /** The label used in order to bump version -- default is patch */
  label?: string;

  /** The command to build the project with */
  gradleCommand: string;

  /** The command to bump to a release version/commit */
  updateReleaseVersionCommand: string;

  /** The command to update snapshot version/commit */
  updateSnapshotVersionCommand: string;

}

/** Get the previous version from the the file that has the version */
async function getPreviousVersion(auto: Auto, path: string) : Promise<string> {
  const filePath = path || 'version.json';
  let versionProperties;
  
  await fs.readFile(filePath, 'utf-8', (err, data) => {
    if (err) throw err;
    versionProperties = JSON.parse(data);
  });

  if (versionProperties) {
    if ('version' in versionProperties) {
      return versionProperties["version"];
    }
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
      label: options.label || 'patch',
      versionFile: options.versionFile,
      gradleCommand: options.gradleCommand,
      updateReleaseVersionCommand: options.updateReleaseVersionCommand || '',
      updateSnapshotVersionCommand: options.updateSnapshotVersionCommand || ''
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

  auto.hooks.getPreviousVersion.tapPromise(this.name, async prefixRelease => {
    return prefixRelease(await getPreviousVersion(auto, this.options.versionFile));
  });

  auto.hooks.version.tapPromise(this.name, async version => {
    const gradleCommand = this.options.gradleCommand
    this.previousVersion = await getPreviousVersion(auto, this.options.versionFile);

    //
    // get new version by using labels -- no SNAPSHOT will every really be present for mobile
    // 
    // eslint-disable-next-line
    // todo: get the version from the github release and compare to this and take the one that is more ahead
    this.newVersion = inc(this.previousVersion, version as ReleaseType) || '';

    if (!this.newVersion) {
      throw new Error(
        `Could not increment previous version: ${this.previousVersion}`
      );
    }

    await execPromise(gradleCommand, ['clean']);
    await execPromise(gradleCommand, [
      'confirmReleaseVersion',
      '-Prelease.useAutomaticVersion=true',
      `-Prelease.releaseVersion=${this.previousVersion}`,
      `-Prelease.newVersion=${this.newVersion}`
    ]);
    await execPromise(gradleCommand, [
      'runBuildTasks',
    ]); 
 
    await execPromise('git', ['checkout', '-b', 'dev-snapshot']);
    await execPromise('git', ['checkout', 'master']);
    await execPromise('git', ['reset', '--hard', 'HEAD~1']);
  });

  auto.hooks.publish.tapPromise(this.name, async () => {
    auto.logger.log.await('Publishing Tag to GitHUB...');

    await execPromise('git', [
      'push',
      '--follow-tags',
      '--set-upstream',
      'origin',
      auto.baseBranch
    ]);

    await execPromise(this.options.gradleCommand, [
      'updateVersion',
      '-Prelease.useAutomaticVersion=true',
      `-Prelease.releaseVersion=${this.previousVersion}`,
      `-Prelease.newVersion=${this.newVersion}`
    ])
  });

  auto.hooks.afterShipIt.tapPromise(this.name, async () => {
    // prepare for next development iteration
    await execPromise('git', ['reset', '--hard', 'dev-snapshot']);
    await execPromise('git', ['branch', '-d', 'dev-snapshot']);
    await execPromise('git', ['push', 'origin', auto.baseBranch]);
  });

  }
}
