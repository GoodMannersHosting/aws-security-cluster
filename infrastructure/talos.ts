import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";
import type { ClusterConfig } from "./config";
import { cidrMaskSize } from "./locals";
import type { ControlPlaneSpec, WorkerSpec } from "./network";
import type { NetworkOutputs } from "./network";
import {
  buildControlPlanePatch,
  buildTailscalePatch,
  buildWorkerPatch,
  type PatchRuntime,
} from "./talosPatches";

const API_PORT_K8S = 6443;

export interface TalosOutputs {
  secrets: talos.machine.Secrets;
  talosClientConfigResult: pulumi.Output<talos.client.GetConfigurationResult>;
  controlPlaneMachineConfigs: pulumi.Output<string>[];
  workerMachineConfigs: pulumi.Output<string>[];
  clusterEndpointInternal: string;
}

export function createTalosConfigs(
  config: ClusterConfig,
  net: NetworkOutputs,
  controlPlaneSpecs: ControlPlaneSpec[],
  workerSpecs: WorkerSpec[]
): TalosOutputs {
  const defaultClusterApiHostPrivate = `kube.${config.clusterDomain}`;
  const clusterApiHostPrivateInternal =
    config.clusterApiHostPrivate?.trim() ?? defaultClusterApiHostPrivate;

  const clusterEndpointHost: pulumi.Output<string> = config.clusterApiHostPrivate
    ? pulumi.output(config.clusterApiHostPrivate.trim())
    : config.enableAliasIp
      ? pulumi.output(clusterApiHostPrivateInternal)
      : config.clusterApiHost
        ? pulumi.output(config.clusterApiHost.trim())
        : net.floatingIp
          ? net.floatingIp.ipAddress
          : net.controlPlanePublicIpv4List[0];
  const clusterEndpointUrlInternal = clusterEndpointHost.apply(
    (h) => `https://${h}:${API_PORT_K8S}`
  );
  const clusterEndpointInternalStr = config.clusterApiHostPrivate?.trim() ?? clusterApiHostPrivateInternal;

  const certSANs = pulumi.all([
    ...net.controlPlanePublicIpv4List,
    ...net.controlPlanePrivateIpv4List,
    clusterEndpointHost,
    config.enableAliasIp ? net.controlPlanePrivateVipIpv4 : null,
    net.floatingIp ? net.floatingIp.ipAddress : null,
  ]).apply((all) =>
    [...new Set(all.filter((x): x is string => x != null && x !== ""))]
  );

  const extraHostEntries = config.enableAliasIp
    ? [
        {
          ip: net.controlPlanePrivateVipIpv4,
          aliases: [
            defaultClusterApiHostPrivate,
            clusterApiHostPrivateInternal,
          ].filter((a, i, arr) => arr.indexOf(a) === i),
        },
      ]
    : [];

  const runtimeOutput = pulumi
    .all([
      net.floatingIp?.ipAddress ?? pulumi.output(null),
      certSANs,
      net.network.id,
      pulumi.output(config.hcloudToken),
    ])
    .apply(([floatingIpAddress, certSANsList, networkId, hcloudToken]) => {
      const r: PatchRuntime = {
        floatingIpAddress: floatingIpAddress ?? null,
        privateVipAddress: net.controlPlanePrivateVipIpv4,
        nodeIpv4Cidr: config.nodeIpv4Cidr,
        nodeIpv4CidrMaskSize: cidrMaskSize(config.nodeIpv4Cidr),
        certSANs: certSANsList,
        extraHostEntries,
        hcloudToken: hcloudToken as string,
        networkId: networkId.toString(),
        workerCount: workerSpecs.length,
      };
      return r;
    });

  const tailscalePatch = buildTailscalePatch(config);

  const secrets = new talos.machine.Secrets("talos-secrets", {
    talosVersion: config.talosVersion,
  });

  const controlPlaneMachineConfigs: pulumi.Output<string>[] = [];
  for (let i = 0; i < controlPlaneSpecs.length; i++) {
    const spec = controlPlaneSpecs[i]!;
    const configPatches = [
      runtimeOutput.apply((r) => JSON.stringify(buildControlPlanePatch(config, r, spec.labels, spec.taints))),
      ...config.talosControlPlaneExtraConfigPatches,
      ...(tailscalePatch ? [tailscalePatch] : []),
    ];
    const result = talos.machine.getConfigurationOutput({
      clusterName: config.clusterName,
      clusterEndpoint: clusterEndpointUrlInternal,
      machineType: "controlplane",
      machineSecrets: secrets.machineSecrets,
      kubernetesVersion: config.kubernetesVersion,
      talosVersion: config.talosVersion,
      configPatches,
      docs: false,
      examples: false,
    });
    controlPlaneMachineConfigs.push(result.machineConfiguration);
  }

  const workerMachineConfigs: pulumi.Output<string>[] = [];
  for (let i = 0; i < workerSpecs.length; i++) {
    const spec = workerSpecs[i]!;
    const configPatches = [
      runtimeOutput.apply((r) => JSON.stringify(buildWorkerPatch(config, r, spec.labels, spec.taints))),
      ...config.talosWorkerExtraConfigPatches,
    ];
    const result = talos.machine.getConfigurationOutput({
      clusterName: config.clusterName,
      clusterEndpoint: clusterEndpointUrlInternal,
      machineType: "worker",
      machineSecrets: secrets.machineSecrets,
      kubernetesVersion: config.kubernetesVersion,
      talosVersion: config.talosVersion,
      configPatches,
      docs: false,
      examples: false,
    });
    workerMachineConfigs.push(result.machineConfiguration);
  }

  const talosconfigEndpoints =
    config.talosconfigEndpointsMode === "private_ip"
      ? pulumi.all(net.controlPlanePrivateIpv4List)
      : pulumi.all(net.controlPlanePublicIpv4List);

  const talosClientConfigResult = talos.client.getConfigurationOutput({
    clusterName: config.clusterName,
    clientConfiguration: secrets.clientConfiguration,
    endpoints: talosconfigEndpoints,
  });

  return {
    secrets,
    talosClientConfigResult,
    controlPlaneMachineConfigs,
    workerMachineConfigs,
    clusterEndpointInternal: clusterEndpointInternalStr,
  };
}
