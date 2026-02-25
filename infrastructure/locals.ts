import * as pulumi from "@pulumi/pulumi";

/**
 * Compute derived values (CIDR helpers, node lists, etc.) used across the stack.
 * Mirrors Terraform "locals" and network.tf / server.tf locals.
 */

export interface ControlPlaneSpec {
  index: number;
  name: string;
  location: string;
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
  location: string;
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
  let addr =
    (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!;
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

const CIDR_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

/** Validates CIDR format (a.b.c.d/prefix); throws if invalid. Prefer RFC1918 ranges. */
export function validateCidr(cidr: string, name: string): void {
  if (!cidr || typeof cidr !== "string") {
    throw new Error(`${name}: CIDR is required`);
  }
  const trimmed = cidr.trim();
  const m = trimmed.match(CIDR_REGEX);
  if (!m) {
    throw new Error(`${name}: invalid CIDR (e.g. 10.0.0.0/16): ${cidr}`);
  }
  const [, a, b, c, d, prefix] = m.map((x) => parseInt(x!, 10));
  if ([a, b, c, d].some((o) => o > 255) || prefix < 8 || prefix > 30) {
    throw new Error(`${name}: invalid octets or prefix length 8-30`);
  }
}

const CIDR_IPV6_REGEX = /^[0-9a-fA-F:]{4,}\/\d{1,3}$/;

/** Validates IPv6 CIDR format; throws if invalid. */
export function validateCidrIpv6(cidr: string, name: string): void {
  if (!cidr || typeof cidr !== "string") {
    throw new Error(`${name}: IPv6 CIDR is required`);
  }
  const trimmed = cidr.trim();
  if (!CIDR_IPV6_REGEX.test(trimmed)) {
    throw new Error(
      `${name}: invalid IPv6 CIDR (e.g. fd00:10:16::/56): ${cidr}`,
    );
  }
  const [, prefix] = trimmed.split("/");
  const bits = parseInt(prefix!, 10);
  if (bits < 16 || bits > 64) {
    throw new Error(`${name}: IPv6 prefix length must be 16-64`);
  }
}

export const API_PORT_K8S = 6443;
export const API_PORT_KUBE_PRISM = 7445;

export const DEFAULT_ISO_BOOT_IMAGE = "debian-13";
