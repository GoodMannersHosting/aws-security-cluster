/**
 * Security groups for database, authentik services, and ALB.
 */
import * as aws from "@pulumi/aws";

import { vpc } from "./vpc";

const databaseSg = new aws.ec2.SecurityGroup("DatabaseSG", {
  vpcId: vpc.id,
  description: "Security Group for authentik RDS PostgreSQL",
  egress: [
    { protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 },
  ],
});

const authentikSg = new aws.ec2.SecurityGroup("AuthentikSG", {
  vpcId: vpc.id,
  description: "Security Group for authentik services",
  egress: [
    { protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 },
  ],
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

export { databaseSg, authentikSg };
