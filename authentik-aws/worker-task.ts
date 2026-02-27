/**
 * ECS task definition for the Authentik worker service.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import {
  authentikImage,
  authentikVersion,
  authentikWorkerCpu,
  authentikWorkerMemory,
  regionName,
} from "./config";
import { auroraCluster } from "./database";
import { authentikSecretKeySecret, dbSecret } from "./secrets";
import { workerLogGroup } from "./logs";
import { storageBucket } from "./storage";
import { workerExecutionRole, workerTaskRole } from "./iam-worker";

const workerTaskDef = new aws.ecs.TaskDefinition("AuthentikWorkerTask", {
  family: "AuthentikStackAuthentikWorkerTask",
  cpu: String(authentikWorkerCpu),
  memory: String(authentikWorkerMemory),
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: workerExecutionRole.arn,
  taskRoleArn: workerTaskRole.arn,
  containerDefinitions: pulumi
    .all([
      auroraCluster.endpoint,
      dbSecret.arn,
      authentikSecretKeySecret.arn,
      workerLogGroup.name,
      storageBucket.id,
      regionName,
    ])
    .apply(([dbEndpoint, dbArn, keyArn, logGroup, bucketName, reg]: string[]) =>
      JSON.stringify([
        {
          name: "AuthentikWorkerContainer",
          image: `${authentikImage}:${authentikVersion}`,
          command: ["worker"],
          essential: true,
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
              "awslogs-stream-prefix": "authentik-worker",
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

export { workerTaskDef };
