/**
 * ECS services: Authentik server (discovered by Traefik) and worker.
 */
import * as aws from "@pulumi/aws";

import {
  authentikServerDesiredCount,
  authentikWorkerDesiredCount,
  enableSpot,
  spotServerOnDemandBase,
} from "../config";
import { privateSubnetIds } from "../core";
import { ecsCluster } from "./cluster";
import { serverTaskDef } from "./server-task";
import { workerTaskDef } from "./worker-task";
import { authentikSg } from "../networking/security-groups";

const serverService = new aws.ecs.Service("AuthentikServerService", {
  cluster: ecsCluster.arn,
  taskDefinition: serverTaskDef.arn,
  desiredCount: authentikServerDesiredCount,
  capacityProviderStrategies: enableSpot
    ? [
        { capacityProvider: "FARGATE", weight: 1, base: spotServerOnDemandBase },
        { capacityProvider: "FARGATE_SPOT", weight: 4, base: 0 },
      ]
    : [{ capacityProvider: "FARGATE", weight: 1, base: 0 }],
  forceNewDeployment: true,
  enableExecuteCommand: true,
  healthCheckGracePeriodSeconds: 60,
  networkConfiguration: {
    subnets: privateSubnetIds,
    securityGroups: [authentikSg.id],
    assignPublicIp: false,
  },
  deploymentCircuitBreaker: { enable: false, rollback: false },
  deploymentMaximumPercent: 200,
  deploymentMinimumHealthyPercent: 50,
}, { dependsOn: [serverTaskDef] });

const workerService = new aws.ecs.Service("AuthentikWorkerService", {
  cluster: ecsCluster.arn,
  taskDefinition: workerTaskDef.arn,
  desiredCount: authentikWorkerDesiredCount,
  capacityProviderStrategies: enableSpot
    ? [{ capacityProvider: "FARGATE_SPOT", weight: 1, base: 0 }]
    : [{ capacityProvider: "FARGATE", weight: 1, base: 0 }],
  forceNewDeployment: true,
  enableExecuteCommand: true,
  networkConfiguration: {
    subnets: privateSubnetIds,
    securityGroups: [authentikSg.id],
    assignPublicIp: false,
  },
  deploymentCircuitBreaker: { enable: false, rollback: false },
  deploymentMaximumPercent: 200,
  deploymentMinimumHealthyPercent: 50,
}, { dependsOn: [workerTaskDef] });

export { serverService, workerService };
