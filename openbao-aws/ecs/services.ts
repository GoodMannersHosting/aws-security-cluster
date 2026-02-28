/**
 * ECS service: OpenBao server.
 */
import * as aws from "@pulumi/aws";

import {
  desiredCount,
  enableSpot,
  spotOnDemandBase,
} from "../config";
import { ecsCluster } from "./cluster";
import { tg, httpsListener } from "./alb";
import { taskDef } from "./task";
import { openbaoSg } from "../networking/security-groups";
import { privateSubnet1, privateSubnet2 } from "../networking/vpc";

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
  healthCheckGracePeriodSeconds: 120,
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [openbaoSg.id],
    assignPublicIp: false,
  },
  loadBalancers: [{ targetGroupArn: tg.arn, containerName: "openbao", containerPort: 8200 }],
  deploymentCircuitBreaker: { enable: false, rollback: false },
  deploymentMaximumPercent: 200,
  deploymentMinimumHealthyPercent: 50,
}, { dependsOn: [httpsListener, taskDef] });
