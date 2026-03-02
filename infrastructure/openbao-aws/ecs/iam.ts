/**
 * IAM roles and KMS key for the OpenBao ECS task.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { namePrefix } from "../config";
import { dbSecret } from "../data/database";
import { logGroup } from "./logs";

const executionRole = new aws.iam.Role("OpenBaoExecutionRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
  name: "openbao-execution-role",
});
new aws.iam.RolePolicyAttachment("OpenBaoExecutionPolicy", {
  role: executionRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
});
new aws.iam.RolePolicy("OpenBaoExecutionSecrets", {
  role: executionRole.id,
  policy: pulumi.all([dbSecret.arn, logGroup.arn]).apply(
    ([secretArn, logArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
            Resource: secretArn,
          },
          { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: `${logArn}:*` },
        ],
      })
  ),
});

const taskRole = new aws.iam.Role("OpenBaoTaskRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
  name: "openbao-task-role",
});

const caller = pulumi.output(aws.getCallerIdentity({}));
const kmsKey = new aws.kms.Key("OpenBaoSealKey", {
  description: "OpenBao seal key for auto-unseal",
  deletionWindowInDays: 30,
  policy: pulumi.all([caller.accountId, taskRole.arn]).apply(
    ([accountId, roleArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Id: "openbao-seal-key-policy",
        Statement: [
          {
            Sid: "Root",
            Effect: "Allow",
            Principal: { AWS: `arn:aws:iam::${accountId}:root` },
            Action: "kms:*",
            Resource: "*",
          },
          {
            Sid: "ECSTaskRole",
            Effect: "Allow",
            Principal: { AWS: roleArn },
            Action: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
            Resource: "*",
          },
        ],
      })
  ),
  tags: { Name: `${namePrefix}/SealKey` },
});
new aws.kms.Alias("OpenBaoSealKeyAlias", {
  name: "alias/openbao-seal",
  targetKeyId: kmsKey.keyId,
});

new aws.iam.RolePolicy("OpenBaoTaskKms", {
  role: taskRole.id,
  policy: kmsKey.arn.apply(
    (keyArn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
            Resource: keyArn,
          },
        ],
      })
  ),
});

new aws.iam.RolePolicy("OpenBaoTaskExec", {
  role: taskRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ],
        Resource: "*",
      },
    ],
  }),
});

export { executionRole, taskRole, kmsKey };
