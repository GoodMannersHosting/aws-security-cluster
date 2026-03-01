/**
 * Network Load Balancer: TCP 80 and 443 passthrough to Traefik.
 */
import * as aws from "@pulumi/aws";

import { namePrefix } from "../config";
import { vpc, publicSubnet1, publicSubnet2 } from "../networking/vpc";

const nlb = new aws.lb.LoadBalancer("CoreNLB", {
  loadBalancerType: "network",
  subnets: [publicSubnet1.id, publicSubnet2.id],
  enableCrossZoneLoadBalancing: true,
  tags: { Name: `${namePrefix}/NLB` },
});

const tg80 = new aws.lb.TargetGroup("TraefikTG80", {
  port: 80,
  protocol: "TCP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    protocol: "TCP",
    port: "80",
    interval: 30,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  },
  tags: { Name: `${namePrefix}/Traefik-80` },
});

const tg443 = new aws.lb.TargetGroup("TraefikTG443", {
  port: 443,
  protocol: "TCP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    protocol: "TCP",
    port: "443",
    interval: 30,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  },
  tags: { Name: `${namePrefix}/Traefik-443` },
});

new aws.lb.Listener("NLB80", {
  loadBalancerArn: nlb.arn,
  port: 80,
  protocol: "TCP",
  defaultActions: [{ type: "forward", targetGroupArn: tg80.arn }],
});

new aws.lb.Listener("NLB443", {
  loadBalancerArn: nlb.arn,
  port: 443,
  protocol: "TCP",
  defaultActions: [{ type: "forward", targetGroupArn: tg443.arn }],
});

export { nlb, tg80, tg443 };
