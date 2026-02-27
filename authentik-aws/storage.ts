/**
 * S3 bucket for Authentik media/static storage.
 */
import * as aws from "@pulumi/aws";

import { domainName, namePrefix } from "./config";

const storageBucket = new aws.s3.Bucket("AuthentikStorage", {
  tags: { Name: `${namePrefix}/AuthentikStorage` },
});
new aws.s3.BucketServerSideEncryptionConfiguration(
  "AuthentikStorageEncryption",
  {
    bucket: storageBucket.id,
    rules: [
      {
        applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" },
        bucketKeyEnabled: true,
      },
    ],
  },
);
new aws.s3.BucketPublicAccessBlock("AuthentikStoragePublicAccessBlock", {
  bucket: storageBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});
new aws.s3.BucketCorsConfiguration("AuthentikStorageCors", {
  bucket: storageBucket.id,
  corsRules: [
    {
      allowedOrigins: domainName ? [`https://${domainName}`] : ["*"],
      allowedHeaders: ["Authorization"],
      allowedMethods: ["GET"],
      maxAgeSeconds: 3000,
    },
  ],
});

export { storageBucket };
