/**
 * Secrets Manager: DB password and connection secret.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

import { namePrefix } from "../config";

const dbPassword = new random.RandomPassword("DBPassword", {
  length: 64,
  overrideSpecial: "!#$%&*()_+-=[]{}|;:,.<>?",
  special: true,
});

const stackName = pulumi.getStack();
const dbSecret = new aws.secretsmanager.Secret("OpenBaoDBSecret", {
  name: `openbao-db-connection-${stackName}`,
  tags: { Name: `${namePrefix}/DBSecret` },
});

export { dbPassword, dbSecret };
