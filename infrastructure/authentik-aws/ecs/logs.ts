/**
 * CloudWatch log groups for server and worker.
 */
import * as aws from "@pulumi/aws";

const serverLogGroup = new aws.cloudwatch.LogGroup("AuthentikServerLogGroup", {
  retentionInDays: 7,
});
const workerLogGroup = new aws.cloudwatch.LogGroup("AuthentikWorkerLogGroup", {
  retentionInDays: 7,
});

export { serverLogGroup, workerLogGroup };
