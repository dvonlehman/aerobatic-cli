const log = require('winston');
const inquirer = require('inquirer');
const urlJoin = require('url-join');
const userConfig = require('../lib/user-config');
const api = require('../lib/api');
const output = require('../lib/output');

module.exports = program => {
  output('Login to Aerobatic\n');
  if (!program.email) {
    output('If you don\'t already have an account, register at https://aerobatic.com/register\n');
  }

  // Prompt for login
  return inquirer.prompt([
    {
      type: 'input',
      name: 'email',
      default: program.email,
      message: 'Email:'
    }, {
      type: 'password',
      name: 'password',
      message: 'Password:'
    }
  ])
  .then(answers => {
    return api.post({
      url: urlJoin(program.apiUrl, '/auth/login'),
      body: {email: answers.email, password: answers.password},
      requireAuth: false
    })
    .then(result => {
      return userConfig.set({
        authToken: result.idToken,
        email: answers.email,
        customerRoles: result.customerRoles
      });
    });
  })
  .then(config => {
    Object.assign(program, config);
    log.info('Successfully logged in');
    return null;
  });
};
