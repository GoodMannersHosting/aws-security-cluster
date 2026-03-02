/**
 * IAM roles and policies for the Authentik worker ECS task.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { authentikSecretKeySecret, dbSecret } from "../data/secrets";
import { workerLogGroup } from "./logs";
import { storageBucket } from "../data/storage";

const workerExecutionRole = new aws.iam.Role("AuthentikWorkerExecutionRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
      },
    ],
  }),
});
new aws.iam.RolePolicyAttachment("AuthentikWorkerExecutionRolePolicy", {
  role: workerExecutionRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
});
const workerExecutionPolicy = new aws.iam.RolePolicy(
  "AuthentikWorkerExecutionPolicy",
  {
    role: workerExecutionRole.id,
    policy: pulumi
      .all([dbSecret.arn, authentikSecretKeySecret.arn, workerLogGroup.arn])
      .apply(([dbArn, keyArn, logArn]: string[]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret",
              ],
              Resource: [dbArn, keyArn],
            },
            {
              Effect: "Allow",
              Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
              Resource: `${logArn}:*`,
            },
          ],
        }),
      ),
  },
);

const workerTaskRole = new aws.iam.Role("AuthentikWorkerTaskRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
      },
    ],
  }),
});
new aws.iam.RolePolicy("AuthentikWorkerTaskRolePolicy", {
  role: workerTaskRole.id,
  policy: pulumi.all([storageBucket.arn]).apply(([bucketArn]: string[]) =>
    JSON.stringify({
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
        { Effect: "Allow", Action: "logs:DescribeLogGroups", Resource: "*" },
        {
          Effect: "Allow",
          Action: [
            "logs:CreateLogStream",
            "logs:DescribeLogStreams",
            "logs:PutLogEvents",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: ["s3:ListBucket"],
          Resource: bucketArn,
        },
        {
          Effect: "Allow",
          Action: [
            "s3:GetObject",
            "s3:PutObject",
            "s3:DeleteObject",
            "s3:HeadObject",
            "s3:CreateMultipartUpload",
            "s3:CompleteMultipartUpload",
            "s3:AbortMultipartUpload",
          ],
          Resource: `${bucketArn}/*`,
        },
      ],
    }),
  ),
});

export { workerExecutionRole, workerTaskRole };
