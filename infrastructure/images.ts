import * as hcloud from "@pulumi/hcloud";
import type { ClusterConfig } from "./config";
import { DEFAULT_ISO_BOOT_IMAGE } from "./locals";

export interface ResolvedImages {
  armImageId: string | number | undefined;
  x86ImageId: string | number | undefined;
  armIsoId: string | undefined;
  x86IsoId: string | undefined;
}

export async function resolveTalosImages(
  config: ClusterConfig,
): Promise<ResolvedImages> {
  let armImageId: string | number | undefined = config.talosImageIdArm;
  let x86ImageId: string | number | undefined = config.talosImageIdX86;
  const armIsoId: string | undefined = config.talosIsoIdArm;
  const x86IsoId: string | undefined = config.talosIsoIdX86;

  if (!armImageId && !armIsoId && !config.disableArm) {
    try {
      const img = await hcloud.getImage({
        withSelector: "os=talos",
        withArchitecture: "arm",
        mostRecent: true,
      });
      armImageId = img.id;
    } catch (_err) {
      armImageId = undefined;
    }
  }
  if (!x86ImageId && !x86IsoId && !config.disableX86) {
    try {
      const img = await hcloud.getImage({
        withSelector: "os=talos",
        withArchitecture: "x86",
        mostRecent: true,
      });
      x86ImageId = img.id;
    } catch (_err) {
      x86ImageId = undefined;
    }
  }

  if (armIsoId && !armImageId) armImageId = DEFAULT_ISO_BOOT_IMAGE;
  if (x86IsoId && !x86ImageId) x86ImageId = DEFAULT_ISO_BOOT_IMAGE;

  return { armImageId, x86ImageId, armIsoId, x86IsoId };
}
