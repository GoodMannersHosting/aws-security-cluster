/**
 * Route53 A record for openbaoDomain pointing to the core NLB.
 */
import * as aws from "@pulumi/aws";

import { openbaoDomain } from "../config";
import { hostedZoneId, nlbDnsName, nlbZoneId } from "../core";

const openbaoRecord = new aws.route53.Record("OpenBaoRecord", {
  zoneId: hostedZoneId,
  name: openbaoDomain,
  type: "A",
  aliases: [
    {
      name: nlbDnsName,
      zoneId: nlbZoneId,
      evaluateTargetHealth: false,
    },
  ],
});

export { openbaoRecord };
