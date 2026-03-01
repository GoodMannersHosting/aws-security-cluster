/**
 * ECS cluster and Fargate capacity providers.
 */
import * as aws from "@pulumi/aws";

import { namePrefix } from "../config";

const ecsCluster = new aws.ecs.Cluster("CoreCluster", {
  name: "core-cluster",
  tags: { Name: `${namePrefix}/Cluster` },
});

new aws.ecs.ClusterCapacityProviders("CoreCapacityProviders", {
  clusterName: ecsCluster.name,
  capacityProviders: ["FARGATE", "FARGATE_SPOT"],
});

export { ecsCluster };
