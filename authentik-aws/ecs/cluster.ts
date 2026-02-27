/**
 * ECS cluster and Fargate capacity providers.
 */
import * as aws from "@pulumi/aws";

const ecsCluster = new aws.ecs.Cluster("AuthentikCluster", {});

new aws.ecs.ClusterCapacityProviders("AuthentikClusterCapacityProviders", {
  clusterName: ecsCluster.name,
  capacityProviders: ["FARGATE", "FARGATE_SPOT"],
});

export { ecsCluster };
