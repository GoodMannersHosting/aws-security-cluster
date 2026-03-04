/**
 * Security groups for Traefik (ingress from NLB) and NLB target access.
 */
import * as aws from "@pulumi/aws";

import { namePrefix, vpcCidr } from "../config";
import { vpc } from "./vpc";

/** Traefik ECS tasks: 80/443 from VPC (NLB health checks and client traffic via NLB). */
export const traefikSg = new aws.ec2.SecurityGroup("TraefikSG", {
  vpcId: vpc.id,
  description: "Traefik ingress - HTTP/HTTPS from NLB",
  ingress: [
    { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: [vpcCidr], description: "HTTP (NLB + clients)" },
    { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: [vpcCidr], description: "HTTPS (NLB + clients)" },
  ],
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
  tags: { Name: `${namePrefix}/Traefik` },
});
