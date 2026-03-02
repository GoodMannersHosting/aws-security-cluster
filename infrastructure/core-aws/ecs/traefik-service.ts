/**
 * Traefik ECS service: NLB target groups for 80 and 443.
 */
import * as aws from "@pulumi/aws";

import { enableSpot, traefikDesiredCount } from "../config";
import { ecsCluster } from "./cluster";
import { traefikSg } from "../networking/security-groups";
import { privateSubnet1, privateSubnet2 } from "../networking/vpc";
import { tg80, tg443 } from "./nlb";
import { traefikTaskDef } from "./traefik-task";

const traefikService = new aws.ecs.Service("TraefikService", {
  cluster: ecsCluster.arn,
  taskDefinition: traefikTaskDef.arn,
  desiredCount: traefikDesiredCount,
  platformVersion: "1.4.0", // Required for EFS volumes on Fargate
  capacityProviderStrategies: enableSpot
    ? [
        { capacityProvider: "FARGATE", weight: 1, base: 1 },
        { capacityProvider: "FARGATE_SPOT", weight: 4, base: 0 },
      ]
    : [{ capacityProvider: "FARGATE", weight: 1, base: 0 }],
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [traefikSg.id],
    assignPublicIp: false,
  },
  loadBalancers: [
    { targetGroupArn: tg80.arn, containerName: "traefik", containerPort: 80 },
    { targetGroupArn: tg443.arn, containerName: "traefik", containerPort: 443 },
  ],
  enableExecuteCommand: true,
  deploymentCircuitBreaker: { enable: false, rollback: false },
  deploymentMaximumPercent: 200,
  deploymentMinimumHealthyPercent: 50,
});

export { traefikService };
