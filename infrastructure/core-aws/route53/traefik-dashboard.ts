/**
 * Route53 A record for traefik.${domain} pointing to the NLB.
 */
import * as aws from "@pulumi/aws";

import { domain, hostedZoneId } from "../config";
import { nlb } from "../ecs/nlb";

let traefikDashboardRecord: aws.route53.Record | undefined;

if (domain) {
  traefikDashboardRecord = new aws.route53.Record("TraefikDashboard", {
    zoneId: hostedZoneId,
    name: "traefik",
    type: "A",
    aliases: [
      {
        name: nlb.dnsName,
        zoneId: nlb.zoneId,
        evaluateTargetHealth: false,
      },
    ],
  });
}

export { traefikDashboardRecord };
