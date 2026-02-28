/**
 * CloudWatch log group for OpenBao.
 */
import * as aws from "@pulumi/aws";

import { namePrefix } from "../config";

const logGroup = new aws.cloudwatch.LogGroup("OpenBaoLogs", {
  retentionInDays: 7,
  tags: { Name: `${namePrefix}/Logs` },
});

export { logGroup };
