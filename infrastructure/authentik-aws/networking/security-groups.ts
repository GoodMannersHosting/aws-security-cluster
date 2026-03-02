/**
 * Security groups for database and Authentik ECS tasks (VPC from core-aws).
 */
import * as aws from "@pulumi/aws";

import { traefikSecurityGroupId, vpcId } from "../core";

const databaseSg = new aws.ec2.SecurityGroup("DatabaseSG", {
  vpcId: vpcId,
  description: "Security Group for authentik RDS PostgreSQL",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

const authentikSg = new aws.ec2.SecurityGroup("AuthentikSG", {
  vpcId: vpcId,
  description: "Security Group for authentik services",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

new aws.ec2.SecurityGroupRule("DatabaseSGFromAuthentik", {
  type: "ingress",
  securityGroupId: databaseSg.id,
  sourceSecurityGroupId: authentikSg.id,
  fromPort: 5432,
  toPort: 5432,
  protocol: "tcp",
  description: "Allow authentik to connect to RDS PostgreSQL",
});

new aws.ec2.SecurityGroupRule("AuthentikFromTraefik", {
  type: "ingress",
  securityGroupId: authentikSg.id,
  sourceSecurityGroupId: traefikSecurityGroupId,
  fromPort: 9000,
  toPort: 9000,
  protocol: "tcp",
  description: "Traefik to Authentik server",
});

export { databaseSg, authentikSg };
