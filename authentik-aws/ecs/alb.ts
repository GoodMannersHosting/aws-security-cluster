/**
 * Application Load Balancer, target group, and HTTP/HTTPS listeners.
 */
import * as aws from "@pulumi/aws";

import { namePrefix } from "../config";
import { certificateArn } from "../config/cert";
import { authentikSg } from "../networking/security-groups";
import { publicSubnet1, publicSubnet2, vpc } from "../networking/vpc";

const albSg = new aws.ec2.SecurityGroup("AuthentikALBSecurityGroup", {
  vpcId: vpc.id,
  description: "Security Group for ALB AuthentikStackAuthentikALB",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow from anyone on port 80",
    },
    {
      protocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow from anyone on port 443",
    },
  ],
  egress: [
    { protocol: "-1", cidrBlocks: ["0.0.0.0/0"], fromPort: 0, toPort: 0 },
  ],
});

new aws.ec2.SecurityGroupRule("ALBToAuthentik", {
  type: "egress",
  securityGroupId: albSg.id,
  sourceSecurityGroupId: authentikSg.id,
  fromPort: 9000,
  toPort: 9000,
  protocol: "tcp",
  description: "Load balancer to target",
});
new aws.ec2.SecurityGroupRule("AuthentikFromALB", {
  type: "ingress",
  securityGroupId: authentikSg.id,
  sourceSecurityGroupId: albSg.id,
  fromPort: 9000,
  toPort: 9000,
  protocol: "tcp",
  description: "Load balancer to target",
});

const alb = new aws.lb.LoadBalancer("AuthentikALB", {
  loadBalancerType: "application",
  securityGroups: [albSg.id],
  subnets: [publicSubnet1.id, publicSubnet2.id],
  tags: { Name: `${namePrefix}/AuthentikALB` },
});

const serverTg = new aws.lb.TargetGroup("AuthentikServerTargetGroup", {
  name: "auth-server-tg",
  port: 9000,
  protocol: "HTTP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    path: "/-/health/live/",
    matcher: "200",
    interval: 30,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  },
  stickiness: { type: "lb_cookie", enabled: false },
});

const httpListener = new aws.lb.Listener("AuthentikHttpListener", {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [
    {
      type: "redirect",
      redirect: { protocol: "HTTPS", port: "443", statusCode: "HTTP_301" },
    },
  ],
});

const httpsListener = new aws.lb.Listener("AuthentikHttpsListener", {
  loadBalancerArn: alb.arn,
  port: 443,
  protocol: "HTTPS",
  sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
  certificateArn: certificateArn,
  defaultActions: [{ type: "forward", targetGroupArn: serverTg.arn }],
});

export { alb, serverTg, httpsListener };
