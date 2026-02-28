/**
 * Security groups for database and OpenBao ECS tasks.
 */
import * as aws from "@pulumi/aws";

import { vpc } from "./vpc";

const databaseSg = new aws.ec2.SecurityGroup("DatabaseSG", {
  vpcId: vpc.id,
  description: "OpenBao RDS PostgreSQL",
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

const openbaoSg = new aws.ec2.SecurityGroup("OpenBaoECSSG", {
  vpcId: vpc.id,
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

export { databaseSg, openbaoSg };
