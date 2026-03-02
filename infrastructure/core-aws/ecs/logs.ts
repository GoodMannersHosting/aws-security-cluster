/**
 * CloudWatch log group for Traefik.
 */
import * as aws from "@pulumi/aws";

import { namePrefix } from "../config";

const logGroup = new aws.cloudwatch.LogGroup("TraefikLogs", {
  retentionInDays: 7,
  tags: { Name: `${namePrefix}/TraefikLogs` },
});

export { logGroup };
