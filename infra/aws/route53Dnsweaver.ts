import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type Route53DnsweaverArgs = {
  hostedZoneName: string;
  /** Optional Roles Anywhere trust-anchor ARN. When set, also create an RA role. */
  rolesAnywhereTrustAnchorArn?: string;
};

export type Route53DnsweaverResult = {
  hostedZoneId: pulumi.Output<string>;
  policyArn: pulumi.Output<string>;
  userName: pulumi.Output<string>;
  accessKeyId: pulumi.Output<string>;
  secretAccessKey: pulumi.Output<string>;
  rolesAnywhereRoleArn?: pulumi.Output<string>;
};

export function createRoute53Dnsweaver(
  args: Route53DnsweaverArgs,
): Route53DnsweaverResult {
  const zone = aws.route53.getZoneOutput({
    name: args.hostedZoneName,
    privateZone: false,
  });
  const zoneArn = zone.arn;
  const policy = createZonePolicy(zoneArn);
  const user = createIamUser(policy.arn);
  const accessKey = new aws.iam.AccessKey("keeper-dnsweaver-route53", {
    user: user.name,
  });

  const result: Route53DnsweaverResult = {
    hostedZoneId: zone.zoneId,
    policyArn: policy.arn,
    userName: user.name,
    accessKeyId: accessKey.id,
    secretAccessKey: pulumi.secret(accessKey.secret),
  };

  if (args.rolesAnywhereTrustAnchorArn) {
    const raRole = createRolesAnywhereRole(
      policy.arn,
      args.rolesAnywhereTrustAnchorArn,
    );
    result.rolesAnywhereRoleArn = raRole.arn;
  }

  return result;
}

function createZonePolicy(zoneArn: pulumi.Output<string>): aws.iam.Policy {
  return new aws.iam.Policy("keeper-dnsweaver-route53", {
    name: "keeper-dnsweaver-route53",
    description:
      "Zone-scoped Route53 record management for dnsweaver webhook on keeper",
    policy: zoneArn.apply((arn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "ChangeAndListRecords",
            Effect: "Allow",
            Action: [
              "route53:ChangeResourceRecordSets",
              "route53:ListResourceRecordSets",
            ],
            Resource: arn,
          },
          {
            Sid: "GetHostedZone",
            Effect: "Allow",
            Action: ["route53:GetHostedZone"],
            Resource: arn,
          },
          {
            Sid: "ListZonesForSdkDiscovery",
            Effect: "Allow",
            Action: ["route53:ListHostedZones", "route53:ListHostedZonesByName"],
            Resource: "*",
          },
        ],
      }),
    ),
    tags: {
      ManagedBy: "pulumi",
      Project: "keeper-aws-infra",
      Service: "dnsweaver",
    },
  });
}

function createIamUser(policyArn: pulumi.Output<string>): aws.iam.User {
  const user = new aws.iam.User("keeper-dnsweaver-route53", {
    name: "keeper-dnsweaver-route53",
    path: "/keeper/",
    tags: {
      ManagedBy: "pulumi",
      Project: "keeper-aws-infra",
      Service: "dnsweaver",
    },
  });
  new aws.iam.UserPolicyAttachment("keeper-dnsweaver-route53", {
    user: user.name,
    policyArn,
  });
  return user;
}

function createRolesAnywhereRole(
  policyArn: pulumi.Output<string>,
  trustAnchorArn: string,
): aws.iam.Role {
  const role = new aws.iam.Role("keeper-dnsweaver-route53-ra", {
    name: "keeper-dnsweaver-route53-ra",
    description:
      "Roles Anywhere role for keeper dnsweaver Route53 webhook (keyless)",
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "rolesanywhere.amazonaws.com" },
          Action: [
            "sts:AssumeRole",
            "sts:TagSession",
            "sts:SetSourceIdentity",
          ],
          Condition: {
            ArnEquals: {
              "aws:SourceArn": trustAnchorArn,
            },
          },
        },
      ],
    }),
    tags: {
      ManagedBy: "pulumi",
      Project: "keeper-aws-infra",
      Service: "dnsweaver",
    },
  });
  new aws.iam.RolePolicyAttachment("keeper-dnsweaver-route53-ra", {
    role: role.name,
    policyArn,
  });
  return role;
}
