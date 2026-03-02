/**
 * Security groups for Traefik (ingress from NLB) and NLB target access.
 */
import * as aws from "@pulumi/aws";

import { namePrefix } from "../config";
import { vpc } from "./vpc";

/** Traefik ECS tasks: accept 80/443 from anywhere (NLB forwards here). */
export const traefikSg = new aws.ec2.SecurityGroup("TraefikSG", {
  vpcId: vpc.id,
  description: "Traefik ingress - HTTP/HTTPS",
  ingress: [
    { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"], description: "HTTP" },
    { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"], description: "HTTPS" },
  ],
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
  tags: { Name: `${namePrefix}/Traefik` },
});
