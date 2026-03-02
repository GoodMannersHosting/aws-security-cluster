/**
 * Security groups for database and OpenBao ECS tasks (VPC from core-aws).
 */
import * as aws from "@pulumi/aws";

import { vpcId, traefikSecurityGroupId } from "../core";

const databaseSg = new aws.ec2.SecurityGroup("DatabaseSG", {
  vpcId: vpcId,
  description: "OpenBao RDS PostgreSQL",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

const openbaoSg = new aws.ec2.SecurityGroup("OpenBaoECSSG", {
  vpcId: vpcId,
  description: "OpenBao ECS tasks",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

new aws.ec2.SecurityGroupRule("DatabaseFromOpenBao", {
  type: "ingress",
  securityGroupId: databaseSg.id,
  sourceSecurityGroupId: openbaoSg.id,
  fromPort: 5432,
  toPort: 5432,
  protocol: "tcp",
  description: "OpenBao ECS to RDS",
});

new aws.ec2.SecurityGroupRule("OpenBaoFromTraefik", {
  type: "ingress",
  securityGroupId: openbaoSg.id,
  sourceSecurityGroupId: traefikSecurityGroupId,
  fromPort: 8200,
  toPort: 8200,
  protocol: "tcp",
  description: "Traefik to OpenBao",
});

export { databaseSg, openbaoSg };
