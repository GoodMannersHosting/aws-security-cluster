/**
 * IAM roles for Traefik: execution (logs, secrets) and task (ECS discovery, Route53 for ACME DNS-01).
 */
import * as aws from "@pulumi/aws";

import { namePrefix } from "../config";
import { logGroup } from "./logs";

const executionRole = new aws.iam.Role("TraefikExecutionRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
  name: "core-traefik-execution-role",
});
new aws.iam.RolePolicyAttachment("TraefikExecutionPolicy", {
  role: executionRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
});
// EFS: mount and write for acme.json persistence (when using IAM authorization)
new aws.iam.RolePolicy("TraefikExecutionEFS", {
  role: executionRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
        ],
        Resource: "*",
      },
    ],
  }),
});

new aws.iam.RolePolicy("TraefikExecutionLogs", {
  role: executionRole.id,
  policy: logGroup.arn.apply(
    (arn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: `${arn}:*` },
        ],
      })
  ),
});

const taskRole = new aws.iam.Role("TraefikTaskRole", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
  name: "core-traefik-task-role",
});

// ECS provider: discover services in the cluster
new aws.iam.RolePolicy("TraefikEcsDiscovery", {
  role: taskRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "TraefikECSReadAccess",
        Effect: "Allow",
        Action: [
          "ecs:ListClusters",
          "ecs:DescribeClusters",
          "ecs:ListTasks",
          "ecs:DescribeTasks",
          "ecs:DescribeContainerInstances",
          "ecs:DescribeTaskDefinition",
          "ec2:DescribeInstances",
        ],
        Resource: "*",
      },
    ],
  }),
});

// Route53: ACME DNS-01 challenge (create/delete TXT records)
new aws.iam.RolePolicy("TraefikRoute53", {
  role: taskRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "route53:GetChange",
          "route53:ListHostedZones",
          "route53:ListResourceRecordSets",
          "route53:ChangeResourceRecordSets",
        ],
        Resource: "*",
      },
    ],
  }),
});

// ECS Exec
new aws.iam.RolePolicy("TraefikExec", {
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

export { executionRole, taskRole };
