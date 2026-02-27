/**
 * ECS services: Authentik server (web) and worker.
 */
import * as aws from "@pulumi/aws";

import {
  authentikServerDesiredCount,
  authentikWorkerDesiredCount,
  enableSpot,
  spotServerOnDemandBase,
} from "./config";
import { ecsCluster } from "./ecs-cluster";
import { serverTg, httpsListener } from "./alb";
import { serverTaskDef } from "./server-task";
import { workerTaskDef } from "./worker-task";
import { authentikSg } from "./security-groups";
import { privateSubnet1, privateSubnet2 } from "./vpc";

const serverService = new aws.ecs.Service(
  "AuthentikServerService",
  {
    cluster: ecsCluster.arn,
    taskDefinition: serverTaskDef.arn,
    desiredCount: authentikServerDesiredCount,
    capacityProviderStrategies: enableSpot
      ? [
          {
            capacityProvider: "FARGATE",
            weight: 1,
            base: spotServerOnDemandBase,
          },
          { capacityProvider: "FARGATE_SPOT", weight: 4, base: 0 },
        ]
      : [{ capacityProvider: "FARGATE", weight: 1, base: 0 }],
    forceNewDeployment: true,
    enableExecuteCommand: true,
    healthCheckGracePeriodSeconds: 60,
    networkConfiguration: {
      subnets: [privateSubnet1.id, privateSubnet2.id],
      securityGroups: [authentikSg.id],
      assignPublicIp: false,
    },
    loadBalancers: [
      {
        targetGroupArn: serverTg.arn,
        containerName: "AuthentikServerContainer",
        containerPort: 9000,
      },
    ],
    deploymentCircuitBreaker: { enable: false, rollback: false },
    deploymentMaximumPercent: 200,
    deploymentMinimumHealthyPercent: 50,
  },
  { dependsOn: [httpsListener, serverTaskDef] },
);

const workerService = new aws.ecs.Service(
  "AuthentikWorkerService",
  {
    cluster: ecsCluster.arn,
    taskDefinition: workerTaskDef.arn,
    desiredCount: authentikWorkerDesiredCount,
    capacityProviderStrategies: enableSpot
      ? [{ capacityProvider: "FARGATE_SPOT", weight: 1, base: 0 }]
      : [{ capacityProvider: "FARGATE", weight: 1, base: 0 }],
    forceNewDeployment: true,
    enableExecuteCommand: true,
    networkConfiguration: {
      subnets: [privateSubnet1.id, privateSubnet2.id],
      securityGroups: [authentikSg.id],
      assignPublicIp: false,
    },
    deploymentCircuitBreaker: { enable: false, rollback: false },
    deploymentMaximumPercent: 200,
    deploymentMinimumHealthyPercent: 50,
  },
  { dependsOn: [workerTaskDef] },
);

export { serverService, workerService };
