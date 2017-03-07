// const log = require('winston');
const chalk = require('chalk');
const path = require('path');
const _ = require('lodash');
const urlJoin = require('url-join');
const output = require('../lib/output');
const api = require('../lib/api');
const download = require('../lib/download');
const manifest = require('../lib/manifest');

const INVALID_NAME_ERROR = 'Website name is invalid. Must be url-friendly string ' +
  'consisting only of numbers, lowercase letters, and dashes.';

// Command to create a new website
module.exports = program => {
  output.blankLine();
  output('Creating new Aerobatic website' + (program.source ? '' : ' in this directory'));
  output.blankLine();

  return Promise.resolve()
    .then(() => {
      if (_.isString(program.name) && program.name.length > 0) {
        return checkNameAvailability(program);
      }
      return null;
    })
    .then(() => {
      // If a repo argument was provided then create a new folder to extract
      // the repo contents to.
      if (program.source) {
        return createSourceDirectory(program);
      }
      return null;
    })
    .then(() => manifest.loadSafe(program))
    .then(appManifest => {
      return createWebsite(program)
        .then(website => ({website, appManifest}));
    })
    .then(params => {
      params.appManifest.id = params.website.appId;

      return manifest.save(program, params.appManifest).then(() => {
        output('Website ' + chalk.yellow.underline(params.website.url) + ' created.');
        if (program.source) {
          output('To deploy your first version, run ' +
            chalk.underline.green('cd ' + program.name) +
            ' then ' + chalk.underline.green('aero deploy') + '.');
        } else {
          output('To deploy your first version, run ' + chalk.underline.green('aero deploy') + '.');
        }

        output.blankLine();
      });
    });
};

function checkNameAvailability(program) {
  return api.post({
    url: urlJoin(program.apiUrl, '/apps/available'),
    body: {name: program.name},
    authToken: program.authToken
  })
  .then(resp => {
    if (resp.available !== true) {
      return throwNameTakenError(program.name);
    }
    return null;
  });
}

function throwNameTakenError(name) {
  throw Error.create('The website name ' + name + ' is already taken. Please try a different name.', {formatted: true});
}

// Invoke the API to create the website
function createWebsite(program) {
  return api.post({
    url: urlJoin(program.apiUrl, `/customers/${program.customerId}/apps`),
    authToken: program.authToken,
    body: {
      name: _.isString(program.name) ? program.name : null
    }
  })
  .catch(error => {
    switch (error.code) {
      case 'invalidAppName':
        throw Error.create(INVALID_NAME_ERROR, {formatted: true});
      case 'appNameUnavailable':
        throwNameTakenError(program.name);
        break;
      default:
        throw error;
    }
  });
}

function createSourceDirectory(program) {
  return Promise.resolve().then(() => {
    if (!program.name) {
      return getRandomSiteName(program)
        .then(siteName => {
          program.name = siteName;
          return;
        });
    }
    return;
  })
  .then(() => {
    program.cwd = path.join(program.cwd, program.name);
    output('    ' + chalk.dim('Downloading source archive ' + program.source));
    return download(program.source, program.cwd);
  });
}

function getRandomSiteName(program) {
  const opts = {
    url: urlJoin(program.apiUrl, '/apps/random-name'),
    authToken: program.authToken
  };
  return api.get(opts).then(result => result.name);
}
