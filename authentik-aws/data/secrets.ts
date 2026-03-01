/**
 * Secrets Manager: DB password and Authentik secret key.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

import { auroraSnapshotIdentifier } from "../config";

const dbPassword = new random.RandomPassword("DBPassword", {
  length: 64,
  overrideSpecial: "!#$%&*()_+-=[]{}|;:,.<>?",
  special: true,
});
const dbSecret = new aws.secretsmanager.Secret("DBPassword", {});
if (!auroraSnapshotIdentifier) {
  new aws.secretsmanager.SecretVersion("DBPasswordVersion", {
    secretId: dbSecret.id,
    secretString: pulumi.interpolate`{"username":"authentik","password":"${dbPassword.result}"}`,
  });
}

const authentikSecretKey = new random.RandomPassword("AuthentikSecretKey", {
  length: 64,
  overrideSpecial: "@/\"'\\",
  special: true,
});
const authentikSecretKeySecret = new aws.secretsmanager.Secret(
  "AuthentikSecretKey",
  {},
);
const authentikSecretKeyVersion = new aws.secretsmanager.SecretVersion(
  "AuthentikSecretKeyVersion",
  {
    secretId: authentikSecretKeySecret.id,
    secretString: authentikSecretKey.result,
  },
);

export { dbPassword, dbSecret, authentikSecretKeySecret };
