const log = require('winston');
const fs = require('fs-promise');
const path = require('path');
const _ = require('lodash');
const chalk = require('chalk');
const config = require('config');
const request = require('request');
const urlJoin = require('url-join');
const camelCase = require('camel-case');
const pack = require('tar-pack').pack;
const uuid = require('node-uuid');
const Promise = require('bluebird');
const promiseUntil = require('promise-until');
const minimatch = require('minimatch');
const Spinner = require('cli-spinner').Spinner;
const api = require('../lib/api');
const manifest = require('../lib/manifest');
const output = require('../lib/output');

const IGNORE_PATTERNS = ['node_modules/**', '.*', '.*/**',
  '*.tar.gz', 'README.*', 'LICENSE', '**/*.less', '**/*.scss', '**/*.php',
  '**/*.asp', 'package.json', manifest.fileName];

// Command to create a new application
module.exports = program => {
  output.blankLine();

  _.defaults(program, {
    uploader: require('../lib/uploader')
  });

  // Default to
  _.defaults(program, {
    versionId: uuid.v4(),
    deployStage: 'production'
  });

  var spinner = new Spinner('Deploying new Aerobatic application version.. %s');
  spinner.setSpinnerString('|/-\\');
  spinner.start();

  return createTarball(program)
    .then(tarballFile => {
      return uploadTarballToS3(program, tarballFile);
    })
    .then(() => {
      const url = urlJoin(program.apiUrl, `/apps/${program.virtualApp.appId}/versions`);
      const postBody = {
        versionId: program.versionId,
        message: program.versionMessage,
        manifest: _.omit(program.appManifest, 'appId')
      };

      log.debug('Invoke API to create version %s', program.versionId);
      return api.post({url, authToken: program.authToken, body: postBody});
    })
    .then(version => waitForDeployComplete(program, version))
    .then(version => {
      if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
        return flushAppForTest(program).then(() => version);
      }
      return Promise.resolve(version);
    })
    .then(version => {
      spinner.stop(true);
      output('Version ' + version.name + ' deployment complete.');
      output('View now at ' + chalk.underline.yellow(version.deployedUrl));
      output.blankLine();
      return;
    });
};

function createTarball(program) {
  const deployManifest = program.appManifest.deploy;
  const deployDir = deployManifest.directory || program.cwd;

  var ignorePatterns = [].concat(IGNORE_PATTERNS);
  if (_.isArray(deployManifest.ignorePatterns)) {
    ignorePatterns = ignorePatterns.concat(deployManifest.ignore);
  }

  const filter = entry => {
    const filePath = path.relative(deployDir, entry.path);
    return !_.some(ignorePatterns, pattern => minimatch(filePath, pattern));
  };

  const tarballFile = path.join(program.cwd, 'aero-deploy.tar.gz');
  fs.removeSync(tarballFile);

  const outStream = fs.createWriteStream(tarballFile);

  return new Promise((resolve, reject) => {
    log.debug('Create deployment bundle %s', tarballFile);

    pack(deployDir, {filter})
      .pipe(outStream)
      .on('error', reject)
      .on('close', () => resolve(tarballFile));
  });
}

function uploadTarballToS3(program, tarballFile) {
  log.debug('Invoke API to get temporary AWS credentials for uploading tarball to S3');
  return api.get({
    url: urlJoin(program.apiUrl, `/customers/${program.virtualApp.customerId}/deploy-creds`),
    authToken: program.authToken
  })
  .then(creds => {
    // Use the temporary IAM creds to create the S3 connection
    return program.uploader({
      creds: _.mapKeys(creds, (value, key) => camelCase(key)),
      tarballFile,
      key: program.virtualApp.appId + '/' + program.versionId + '.tar.gz',
      bucket: program.deployBucket,
      metadata: {stage: program.deployStage}
    });
  });
}

// Poll the api for the version until the status is no longer "running".
function waitForDeployComplete(program, version) {
  var latestVersionState = version;
  const url = urlJoin(program.apiUrl,
    `/apps/${program.virtualApp.appId}/versions/${version.versionId}?stage=${program.deployStage}`);

  // TODO: Display a progress bar while polling for deploy status updates.
  return promiseUntil(() => {
    switch (latestVersionState.status) {
      case 'queued':
      case 'running': log.info('Version is still deploying'); return false;
      case 'complete': return true;
      case 'failed': throw new Error('Version deployment failed with message: ' + latestVersionState.error);
      default:
        throw new Error('Unexpected version status: ' + latestVersionState.status);
    }
  }, () => {
    return Promise.delay(config.pollVersionStatusInterval)
      .then(() => {
        log.debug('Checking on version status');
        return api.get({url, authToken: program.authToken});
      })
      .then(updatedVersion => {
        latestVersionState = updatedVersion;
        return;
      });
  })
  .then(() => {
    return latestVersionState;
  });
}

// Invoke the local cdn app to flush the app from cache.
function flushAppForTest(program) {
  const params = {
    url: 'http://aerobatic.dev/__internal/flush-cache',
    json: true,
    body: {appIds: [program.virtualApp.appId]}
  };

  log.debug('Flush local cache');
  return new Promise((resolve, reject) => {
    request.post(params, (err, resp, body) => {
      if (err) return reject(err);
      if (resp.statusCode !== 200) {
        return reject(new Error(resp.statusCode + ' status code ' +
          'returned from flush-cache endpoint: ' + JSON.stringify(body)));
      }
      resolve();
    });
  });
}
