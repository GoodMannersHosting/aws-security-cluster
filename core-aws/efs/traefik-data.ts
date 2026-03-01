/**
 * EFS file system for Traefik: shared persistence for acme.json and certificates.
 */
import * as aws from "@pulumi/aws";

import { namePrefix } from "../config";
import { traefikSg } from "../networking/security-groups";
import { vpc } from "../networking/vpc";
import { privateSubnet1, privateSubnet2 } from "../networking/vpc";

const efsSg = new aws.ec2.SecurityGroup("TraefikEFSSG", {
  vpcId: vpc.id,
  description: "EFS for Traefik - NFS from Traefik tasks",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
  tags: { Name: `${namePrefix}/TraefikEFS` },
});

new aws.ec2.SecurityGroupRule("EFSFromTraefik", {
  type: "ingress",
  securityGroupId: efsSg.id,
  sourceSecurityGroupId: traefikSg.id,
  fromPort: 2049,
  toPort: 2049,
  protocol: "tcp",
  description: "NFS from Traefik",
});

const efs = new aws.efs.FileSystem("TraefikEFS", {
  encrypted: true,
  performanceMode: "generalPurpose",
  throughputMode: "bursting",
  tags: { Name: `${namePrefix}/TraefikEFS` },
});

const accessPoint = new aws.efs.AccessPoint("TraefikEFSAccessPoint", {
  fileSystemId: efs.id,
  rootDirectory: {
    path: "/data",
    creationInfo: {
      ownerUid: 0,
      ownerGid: 0,
      permissions: "0755",
    },
  },
  posixUser: {
    uid: 0,
    gid: 0,
  },
  tags: { Name: `${namePrefix}/TraefikEFSAccessPoint` },
});

new aws.efs.MountTarget("TraefikEFSMount1", {
  fileSystemId: efs.id,
  subnetId: privateSubnet1.id,
  securityGroups: [efsSg.id],
});
new aws.efs.MountTarget("TraefikEFSMount2", {
  fileSystemId: efs.id,
  subnetId: privateSubnet2.id,
  securityGroups: [efsSg.id],
});

export { efs, accessPoint };
