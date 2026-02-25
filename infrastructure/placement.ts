import * as hcloud from "@pulumi/hcloud";
import type { ClusterConfig } from "./config";

export interface PlacementOutputs {
  controlPlaneGroup: hcloud.PlacementGroup;
  workerGroup: hcloud.PlacementGroup;
}

export function createPlacementGroups(
  config: ClusterConfig,
  clusterPrefix: string,
): PlacementOutputs {
  const controlPlaneGroup = new hcloud.PlacementGroup("control-plane-pg", {
    name: `${clusterPrefix}control-plane`,
    type: "spread",
    labels: { cluster: config.clusterName },
  });

  const workerGroup = new hcloud.PlacementGroup("worker-pg", {
    name: `${clusterPrefix}worker`,
    type: "spread",
    labels: { cluster: config.clusterName },
  });

  return { controlPlaneGroup, workerGroup };
}
