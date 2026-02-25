/** Talos Image Factory via Pulumi Talos provider. */

import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";
import type { GetUrlsResult } from "@pulumiverse/talos/imagefactory/getUrls";

export const DEFAULT_SCHEMATIC_ID =
  "376567988ad370138ad8b2698212367b8edcb69b5fd68c80be1f2ec7d603b4ba";

export interface ImageFactoryOutputs {
  schematicId: pulumi.Output<string>;
  diskImageUrlX86: pulumi.Output<string>;
  diskImageUrlArm: pulumi.Output<string>;
}

export interface SchematicMetaEntry {
  key: number;
  value: string;
}

export interface SchematicCustomization {
  /** Extra kernel arguments (e.g. ["vga=791"]). */
  extraKernelArgs?: string[];
  /** Initial Talos META entries. */
  meta?: SchematicMetaEntry[];
  /** System extensions to include in the image. */
  systemExtensions?: {
    officialExtensions?: string[];
  };
  /** SecureBoot options (only applies to SecureBoot images). */
  secureboot?: {
    includeWellKnownCertificates?: boolean;
  };
  /** Bootloader: sd-boot, dual-boot, or grub. Defaults to auto. */
  bootloader?: "sd-boot" | "dual-boot" | "grub";
}

export interface SchematicOverlay {
  image: string;
  name: string;
  options?: Record<string, unknown>;
}

export interface SchematicConfig {
  customization?: SchematicCustomization;
  overlay?: SchematicOverlay;
}

export interface CreateImageFactoryArgs {
  talosVersion: string;
  schematicYaml?: string;
  schematicConfig?: SchematicConfig;
}

function diskImageFromResult(r: GetUrlsResult): string {
  return r.urls?.diskImage ?? "";
}

function schematicToString(args: CreateImageFactoryArgs): string {
  if (args.schematicConfig != null) {
    return JSON.stringify(args.schematicConfig);
  }
  return args.schematicYaml ?? "{}";
}

export type SchematicRole = "control-plane" | "worker";

export interface SchematicConfigInput {
  talosSchematicExtensions?: string[];
  talosSchematicExtraKernelArgs?: string[];
  talosSchematicExtensionsControlPlane?: string[];
  talosSchematicExtraKernelArgsControlPlane?: string[];
  talosSchematicExtensionsWorker?: string[];
  talosSchematicExtraKernelArgsWorker?: string[];
}

function buildSchematicConfig(
  exts: string[],
  args: string[],
): SchematicConfig | undefined {
  if (exts.length === 0 && args.length === 0) return undefined;
  const customization: SchematicCustomization = {};
  if (exts.length > 0) {
    customization.systemExtensions = { officialExtensions: exts };
  }
  if (args.length > 0) {
    customization.extraKernelArgs = args;
  }
  return { customization };
}

export function schematicConfigFromClusterConfig(
  config: SchematicConfigInput,
  role?: SchematicRole,
): SchematicConfig | undefined {
  const defExt = config.talosSchematicExtensions?.filter(Boolean) ?? [];
  const defArgs = config.talosSchematicExtraKernelArgs?.filter(Boolean) ?? [];
  let exts: string[];
  let args: string[];
  if (role === "control-plane") {
    const cpExt =
      config.talosSchematicExtensionsControlPlane?.filter(Boolean) ?? [];
    const cpArgs =
      config.talosSchematicExtraKernelArgsControlPlane?.filter(Boolean) ?? [];
    exts = cpExt.length > 0 ? cpExt : defExt;
    args = cpArgs.length > 0 ? cpArgs : defArgs;
  } else if (role === "worker") {
    const wkExt = config.talosSchematicExtensionsWorker?.filter(Boolean) ?? [];
    const wkArgs =
      config.talosSchematicExtraKernelArgsWorker?.filter(Boolean) ?? [];
    exts = wkExt.length > 0 ? wkExt : defExt;
    args = wkArgs.length > 0 ? wkArgs : defArgs;
  } else {
    exts = defExt;
    args = defArgs;
  }
  return buildSchematicConfig(exts, args);
}

export interface SchematicConfigsByRole {
  controlPlane: SchematicConfig | undefined;
  worker: SchematicConfig | undefined;
}

export function getSchematicConfigsForRoles(
  config: SchematicConfigInput,
): SchematicConfigsByRole {
  return {
    controlPlane: schematicConfigFromClusterConfig(config, "control-plane"),
    worker: schematicConfigFromClusterConfig(config, "worker"),
  };
}

export function createImageFactoryOutputs(
  name: string,
  args: CreateImageFactoryArgs,
): ImageFactoryOutputs {
  const schematic = new talos.imagefactory.Schematic(`${name}-schematic`, {
    schematic: schematicToString(args),
  });

  const urlsX86 = talos.imagefactory.getUrlsOutput({
    schematicId: schematic.id,
    talosVersion: args.talosVersion,
    platform: "metal",
    architecture: "amd64",
  });

  const urlsArm = talos.imagefactory.getUrlsOutput({
    schematicId: schematic.id,
    talosVersion: args.talosVersion,
    platform: "metal",
    architecture: "arm64",
  });

  return {
    schematicId: schematic.id,
    diskImageUrlX86: urlsX86.apply(diskImageFromResult),
    diskImageUrlArm: urlsArm.apply(diskImageFromResult),
  };
}

export function getDefaultImageUrls(talosVersion: string): ImageFactoryOutputs {
  const urlsX86 = talos.imagefactory.getUrlsOutput({
    schematicId: DEFAULT_SCHEMATIC_ID,
    talosVersion,
    platform: "metal",
    architecture: "amd64",
  });
  const urlsArm = talos.imagefactory.getUrlsOutput({
    schematicId: DEFAULT_SCHEMATIC_ID,
    talosVersion,
    platform: "metal",
    architecture: "arm64",
  });

  return {
    schematicId: pulumi.output(DEFAULT_SCHEMATIC_ID),
    diskImageUrlX86: urlsX86.apply(diskImageFromResult),
    diskImageUrlArm: urlsArm.apply(diskImageFromResult),
  };
}
