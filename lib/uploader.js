const AWS = require('aws-sdk');
const log = require('winston');
const fs = require('fs');
const s3UploadStream = require('s3-upload-stream');

module.exports = params => {
  // Use the temporary IAM creds to create the S3 connection
  const s3 = new AWS.S3(Object.assign({
    region: 'us-west-2'
  }, params.creds));

  const s3Stream = s3UploadStream(s3);
  const readStream = fs.createReadStream(params.tarballFile);

  // const key = program.virtualApp.customerId + '/' + versionId + '.tar.gz';
  log.debug('Uploading %s to S3 staging bucket', params.key);
  var upload = s3Stream.upload({
    Bucket: params.bucket,
    Key: params.key,
    ContentType: 'application/gzip',
    Metadata: params.Metadata
  });

  return new Promise((resolve, reject) => {
    // Handle errors.
    upload.on('error', error => {
      log.debug('Error uploading to S3');
      reject(new Error(error));
    });

    upload.on('part', details => {
      log.debug(details);
    });

    /* Handle upload completion. Example details object:
    { Location: 'https://bucketName.s3.amazonaws.com/filename.ext',
     Bucket: 'bucketName',
     Key: 'filename.ext',
     ETag: '"bf2acbedf84207d696c8da7dbb205b9f-5"' }
    */
    upload.on('uploaded', details => {
      log.debug('done uploading');
      resolve(details);
    });

    // Pipe the incoming filestream through compression, and up to S3.
    readStream.pipe(upload);
  });
};