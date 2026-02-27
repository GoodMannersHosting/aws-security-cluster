/**
 * IAM roles and policies for the Authentik server ECS task.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { authentikSecretKeySecret, dbSecret } from "./secrets";
import { serverLogGroup } from "./logs";
import { storageBucket } from "./storage";

const serverExecutionRole = new aws.iam.Role("AuthentikServerExecutionRole", {
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
new aws.iam.RolePolicyAttachment("AuthentikServerExecutionRolePolicy", {
  role: serverExecutionRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
});
const serverExecutionPolicy = new aws.iam.RolePolicy(
  "AuthentikServerExecutionPolicy",
  {
    role: serverExecutionRole.id,
    policy: pulumi
      .all([dbSecret.arn, authentikSecretKeySecret.arn, serverLogGroup.arn])
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

const serverTaskRole = new aws.iam.Role("AuthentikServerTaskRole", {
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
new aws.iam.RolePolicy("AuthentikServerTaskRolePolicy", {
  role: serverTaskRole.id,
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

export { serverExecutionRole, serverTaskRole };
