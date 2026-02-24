import * as pulumi from "@pulumi/pulumi";

/**
 * Compute derived values (CIDR helpers, node lists, etc.) used across the stack.
 * Mirrors Terraform "locals" and network.tf / server.tf locals.
 */

export interface ControlPlaneSpec {
  index: number;
  name: string;
  serverType: string;
  imageId: string | number;
  isoId: string | undefined;
  ipv4Public: string;
  ipv6Public: string | undefined;
  ipv6PublicSubnet: string | undefined;
  ipv4Private: string;
  labels: Record<string, string>;
  taints: Array<{ key: string; value: string; effect: string }>;
}

export interface WorkerSpec {
  index: number;
  name: string;
  serverType: string;
  imageId: string | number;
  isoId: string | undefined;
  ipv4Public: string;
  ipv6Public: string | undefined;
  ipv6PublicSubnet: string | undefined;
  ipv4Private: string;
  labels: Record<string, string>;
  taints: Array<{ key: string; value: string; effect: string }>;
}

/** Parse CIDR and return the Nth host (e.g. 100 for VIP). */
export function cidrHost(cidr: string, hostNum: number): string {
  const [base, bits] = cidr.split("/");
  const len = parseInt(bits, 10);
  const parts = base.split(".").map((p) => parseInt(p, 10));
  let addr = (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!;
  addr += hostNum;
  return [
    (addr >>> 24) & 0xff,
    (addr >>> 16) & 0xff,
    (addr >>> 8) & 0xff,
    addr & 0xff,
  ].join(".");
}

/** Get mask size from CIDR (e.g. "10.0.1.0/24" => 24). */
export function cidrMaskSize(cidr: string): string {
  return cidr.split("/")[1] ?? "24";
}

export const API_PORT_K8S = 6443;
export const API_PORT_KUBE_PRISM = 7445;

export const DEFAULT_ISO_BOOT_IMAGE = "debian-13";
