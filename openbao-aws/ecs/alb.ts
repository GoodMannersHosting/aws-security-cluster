/**
 * Application Load Balancer, target group, and HTTP/HTTPS listeners.
 */
import * as aws from "@pulumi/aws";

import { allowedCidrs, namePrefix } from "../config";
import { certificateArn } from "../config/cert";
import { openbaoSg } from "../networking/security-groups";
import { natEip, publicSubnet1, publicSubnet2, vpc } from "../networking/vpc";

const albSg = new aws.ec2.SecurityGroup("ALBSG", {
  vpcId: vpc.id,
  description: "ALB for OpenBao",
  ingress: [
    { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: allowedCidrs, description: "HTTP" },
    { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: allowedCidrs, description: "HTTPS" },
  ],
  egress: [{ protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 }],
});

new aws.ec2.SecurityGroupRule("ALBFromNAT", {
  type: "ingress",
  securityGroupId: albSg.id,
  cidrBlocks: natEip.publicIp.apply((ip) => [`${ip}/32`]),
  fromPort: 443,
  toPort: 443,
  protocol: "tcp",
  description: "NAT egress for init Lambda in VPC",
});

new aws.ec2.SecurityGroupRule("OpenBaoFromALB", {
  type: "ingress",
  securityGroupId: openbaoSg.id,
  sourceSecurityGroupId: albSg.id,
  fromPort: 8200,
  toPort: 8200,
  protocol: "tcp",
  description: "ALB to OpenBao",
});

const alb = new aws.lb.LoadBalancer("OpenBaoALB", {
  loadBalancerType: "application",
  securityGroups: [albSg.id],
  subnets: [publicSubnet1.id, publicSubnet2.id],
  idleTimeout: 300,
  tags: { Name: `${namePrefix}/ALB` },
});

const tg = new aws.lb.TargetGroup("OpenBaoTG", {
  port: 8200,
  protocol: "HTTP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    path: "/v1/sys/health",
    matcher: "200,429",
    interval: 30,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  },
  stickiness: {
    type: "lb_cookie",
    cookieDuration: 86400,
    enabled: true,
  },
  tags: { Name: `${namePrefix}/TG` },
});

const httpListener = new aws.lb.Listener("OpenBaoHttpListener", {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [{ type: "redirect", redirect: { protocol: "HTTPS", port: "443", statusCode: "HTTP_301" } }],
});

const httpsListener = new aws.lb.Listener("OpenBaoHttpsListener", {
  loadBalancerArn: alb.arn,
  port: 443,
  protocol: "HTTPS",
  sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
  certificateArn: certificateArn,
  defaultActions: [{ type: "forward", targetGroupArn: tg.arn }],
});

export { alb, tg, httpsListener };
