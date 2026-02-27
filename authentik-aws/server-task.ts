/**
 * ECS task definition for the Authentik server (web) service.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import {
  authentikImage,
  authentikServerCpu,
  authentikServerMemory,
  authentikVersion,
  regionName,
} from "./config";
import { auroraCluster } from "./database";
import { authentikSecretKeySecret, dbSecret } from "./secrets";
import { serverLogGroup } from "./logs";
import { storageBucket } from "./storage";
import { serverExecutionRole, serverTaskRole } from "./iam-server";

const serverTaskDef = new aws.ecs.TaskDefinition("AuthentikServerTask", {
  family: "AuthentikStackAuthentikServerTask",
  cpu: String(authentikServerCpu),
  memory: String(authentikServerMemory),
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: serverExecutionRole.arn,
  taskRoleArn: serverTaskRole.arn,
  containerDefinitions: pulumi
    .all([
      auroraCluster.endpoint,
      dbSecret.arn,
      authentikSecretKeySecret.arn,
      serverLogGroup.name,
      storageBucket.id,
      regionName,
    ])
    .apply(([dbEndpoint, dbArn, keyArn, logGroup, bucketName, reg]: string[]) =>
      JSON.stringify([
        {
          name: "AuthentikServerContainer",
          image: `${authentikImage}:${authentikVersion}`,
          command: ["server"],
          essential: true,
          portMappings: [{ containerPort: 9000, protocol: "tcp" }],
          environment: [
            { name: "AUTHENTIK_POSTGRESQL__HOST", value: dbEndpoint },
            { name: "AUTHENTIK_POSTGRESQL__USER", value: "authentik" },
            { name: "AUTHENTIK_POSTGRESQL__SSLMODE", value: "require" },
            { name: "AUTHENTIK_STORAGE__BACKEND", value: "s3" },
            { name: "AUTHENTIK_STORAGE__S3__BUCKET_NAME", value: bucketName },
            { name: "AUTHENTIK_STORAGE__S3__REGION", value: reg },
          ],
          secrets: [
            {
              name: "AUTHENTIK_POSTGRESQL__PASSWORD",
              valueFrom: `${dbArn}:password::`,
            },
            { name: "AUTHENTIK_SECRET_KEY", valueFrom: keyArn },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroup,
              "awslogs-stream-prefix": "authentik-server",
              "awslogs-region": reg,
            },
          },
          healthCheck: {
            command: ["CMD", "ak", "healthcheck"],
            interval: 30,
            timeout: 30,
            retries: 3,
            startPeriod: 60,
          },
        },
      ]),
    ),
});

export { serverTaskDef };
