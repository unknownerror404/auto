import fs from 'fs';

import * as Auto from '@auto-it/core';
import { dummyLog } from '@auto-it/core/dist/utils/logger';
import { makeHooks } from '@auto-it/core/dist/utils/make-hooks';
import GradleReleasePlugin, {IGradleReleasePluginPluginOptions} from '../src';

const mockRead = (result: string) =>
  jest
    .spyOn(fs, 'readFile')
    // @ts-ignore
    .mockImplementation((a, b, cb) => cb(undefined, result));

describe('Gradle Release Plugin Plugin', () => {
  let hooks: Auto.IAutoHooks;

  const options: IGradleReleasePluginPluginOptions = {
    versionFile: '',
    gradleCommand: '',
    updateSnapshotVersionCommand: '',
    updateReleaseVersionCommand: '',
  }

  beforeEach(() => {
    const plugin = new GradleReleasePlugin(options);
    hooks = makeHooks();
    plugin.apply({ hooks, logger: dummyLog() } as Auto.Auto);
  })

  describe('getPreviousVersion', () => {
    test('should get previous version from version.json', async () => {
      mockRead(`
        {
          "version": "0.0.1"
        }
      `);
      expect(await hooks.getPreviousVersion.promise(r => r)).toBe('0.0.1');
    });

    test('should throw when no in version.json', async () => {
      mockRead('{}');
      await(expect(hooks.getPreviousVersion.promise(r => r)).rejects
        .toThrowError('No version was found inside version-file.'));
    });

    test('should throw when no version.json', async () => {
      await(expect(hooks.getPreviousVersion.promise(r => r)).rejects
        .toThrowError('No version was found inside version-file.'));
    }); 
  });

  describe('version', () => {
    test('should version release - patch version', async () => {
      mockRead(`
      {
        "version": "0.0.1"
      }
      `);
      const spy = jest.fn();
      jest.spyOn(Auto, 'execPromise').mockImplementation(spy);

      await hooks.version.promise(Auto.SEMVER.patch);
      const call = spy.mock.calls[1][1];
      expect(call).toContain('-Prelease.useAutomaticVersion=true');
      expect(call).toContain('-Prelease.releaseVersion=0.0.1');
      expect(call).toContain('-Prelease.newVersion=0.0.2');
    });

    test('should version release - major version', async () => {
      mockRead(`
      {
        "version": "0.0.1"
      }
      `);
      const spy = jest.fn();
      jest.spyOn(Auto, 'execPromise').mockImplementation(spy);

      await hooks.version.promise(Auto.SEMVER.major);
      const call = spy.mock.calls[1][1];
      expect(call).toContain('-Prelease.useAutomaticVersion=true');
      expect(call).toContain('-Prelease.releaseVersion=0.0.1');
      expect(call).toContain('-Prelease.newVersion=1.0.0');
    });

    test('should version release - minor version', async () => {
      mockRead(`
      {
        "version": "0.1.1"
      }
      `);
      const spy = jest.fn();
      jest.spyOn(Auto, 'execPromise').mockImplementation(spy);

      await hooks.version.promise(Auto.SEMVER.minor);
      const call = spy.mock.calls[1][1];
      expect(call).toContain('-Prelease.useAutomaticVersion=true');
      expect(call).toContain('-Prelease.releaseVersion=0.1.1');
      expect(call).toContain('-Prelease.newVersion=0.2.0');
    });
  });

  describe('publish', () => {
    test('should publish release', async () => {
      mockRead(`
      {
        "version": "0.1.1"
      } 
      `);
      const spy = jest.fn();
      jest.spyOn(Auto, 'execPromise').mockImplementation(spy);

      await hooks.publish.promise(Auto.SEMVER.patch);
      expect(spy.mock.calls[1][1]).toContain('updateVersion');
    });
  });

});
