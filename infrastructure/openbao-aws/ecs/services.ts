/**
 * ECS service: OpenBao server (discovered by Traefik via labels).
 */
import * as aws from "@pulumi/aws";

import { desiredCount, enableSpot, spotOnDemandBase } from "../config";
import { privateSubnetIds } from "../core";
import { ecsCluster } from "./cluster";
import { openbaoSg } from "../networking/security-groups";
import { taskDef } from "./task";

new aws.ecs.Service("OpenBaoService", {
  cluster: ecsCluster.arn,
  taskDefinition: taskDef.arn,
  desiredCount,
  enableExecuteCommand: true,
  capacityProviderStrategies: enableSpot
    ? [
        { capacityProvider: "FARGATE", weight: 1, base: spotOnDemandBase },
        { capacityProvider: "FARGATE_SPOT", weight: 4, base: 0 },
      ]
    : [{ capacityProvider: "FARGATE", weight: 1, base: 0 }],
  forceNewDeployment: true,
  healthCheckGracePeriodSeconds: 30,
  networkConfiguration: {
    subnets: privateSubnetIds,
    securityGroups: [openbaoSg.id],
    assignPublicIp: false,
  },
  deploymentCircuitBreaker: { enable: false, rollback: false },
  deploymentMaximumPercent: 200,
  deploymentMinimumHealthyPercent: 50,
}, { dependsOn: [taskDef] });
