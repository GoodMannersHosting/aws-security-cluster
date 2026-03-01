/**
 * Route53 A record for authentikDomain pointing to the core NLB.
 */
import * as aws from "@pulumi/aws";

import { authentikDomain } from "../config";
import { hostedZoneId, nlbDnsName, nlbZoneId } from "../core";

const authentikRecord = new aws.route53.Record("AuthentikRecord", {
  zoneId: hostedZoneId,
  name: authentikDomain,
  type: "A",
  aliases: [
    {
      name: nlbDnsName,
      zoneId: nlbZoneId,
      evaluateTargetHealth: false,
    },
  ],
});

export { authentikRecord };
