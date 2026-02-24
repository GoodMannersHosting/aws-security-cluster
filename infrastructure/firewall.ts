import * as hcloud from "@pulumi/hcloud";
import type { FirewallRule } from "@pulumi/hcloud/types/input";
import * as pulumi from "@pulumi/pulumi";
import type { ClusterConfig } from "./config";

export interface FirewallOutput {
  firewall: hcloud.Firewall | undefined;
  firewallId: pulumi.Output<string | undefined>;
}

/** Fetch current public IPv4 (e.g. for firewall source). */
export async function getCurrentIpv4(): Promise<string> {
  const res = await fetch("https://ipv4.icanhazip.com");
  const text = await res.text();
  return text.trim();
}

export function createFirewall(
  config: ClusterConfig,
  useCurrentIp: boolean,
  currentIpv4: string
): FirewallOutput {
  const rules: FirewallRule[] = [];

  const kubeSource =
    config.firewallKubeApiSource ??
    (useCurrentIp ? [`${currentIpv4}/32`] : null);
  if (kubeSource && kubeSource.length > 0) {
    rules.push({
      direction: "in",
      protocol: "tcp",
      port: "6443",
      sourceIps: kubeSource,
      description: "Allow Incoming Requests to Kube API Server",
    });
  }

  const talosSource =
    config.firewallTalosApiSource ??
    (useCurrentIp ? [`${currentIpv4}/32`] : null);
  if (talosSource && talosSource.length > 0) {
    rules.push({
      direction: "in",
      protocol: "tcp",
      port: "50000",
      sourceIps: talosSource,
      description: "Allow Incoming Requests to Talos API Server",
    });
  }

  for (const r of config.extraFirewallRules) {
    rules.push({
      direction: r.direction as "in" | "out",
      protocol: r.protocol as "tcp" | "udp" | "icmp" | "esp" | "gre",
      port: r.port,
      sourceIps: r.sourceIps,
      destinationIps: r.destinationIps,
      description: r.description,
    });
  }

  if (config.firewallId != null) {
    return {
      firewall: undefined,
      firewallId: pulumi.output(config.firewallId),
    };
  }

  if (rules.length === 0) {
    return {
      firewall: undefined,
      firewallId: pulumi.output(undefined),
    };
  }

  const firewall = new hcloud.Firewall("cluster-firewall", {
    name: config.clusterName,
    rules,
    labels: { cluster: config.clusterName },
  });

  return {
    firewall,
    firewallId: firewall.id.apply(String),
  };
}
