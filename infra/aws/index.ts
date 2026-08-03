import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { createGithubOidc } from "./githubOidc";
import { createIdentityCenterAuthentik } from "./identityCenterAuthentik";
import { createRoute53Dnsweaver } from "./route53Dnsweaver";

const config = new pulumi.Config();
const awsConfig = new pulumi.Config("aws");

const githubOrg = config.get("githubOrg") ?? "GoodMannersHosting@88983444";
const githubRepo =
  config.get("githubRepo") ?? "cloud-security-cluster@1166064097";
const allowedRefs = config.getObject<string[]>("allowedRefs") ?? [
  "refs/heads/main",
];
const hostedZoneName =
  config.get("hostedZoneName") ?? "goodmanners.services";
const existingOidcProviderArn = config.get("githubOidcProviderArn");
const rolesAnywhereTrustAnchorArn = config.get(
  "rolesAnywhereTrustAnchorArn",
);

const authentikUrl = config.get("authentikUrl");
const icManagementRoleArn = config.get("icManagementRoleArn");
const workloadAccountId = config.get("workloadAccountId");
const icAcsUrl = config.get("icAcsUrl");
const icAudience = config.get("icAudience");
const icScimUrl = config.get("icScimUrl");
const icAssignmentsEnabled = config.getBoolean("icAssignmentsEnabled") ?? false;

const oidc = createGithubOidc({
  githubOrg,
  githubRepo,
  allowedRefs,
  existingProviderArn: existingOidcProviderArn,
  icManagementRoleArn,
});

const dnsweaver = createRoute53Dnsweaver({
  hostedZoneName,
  rolesAnywhereTrustAnchorArn,
});

let assignmentsPending: pulumi.Output<boolean> | undefined;
let adminPermissionSetArn: pulumi.Output<string> | undefined;
let viewerPermissionSetArn: pulumi.Output<string> | undefined;
let authentikApplicationSlug: string | undefined;

if (
  authentikUrl &&
  icManagementRoleArn &&
  workloadAccountId &&
  icAcsUrl &&
  icAudience &&
  icScimUrl
) {
  const managementProvider = new aws.Provider("ic-management", {
    region: (awsConfig.get("region") ?? "us-east-1") as aws.Region,
    assumeRole: { roleArn: icManagementRoleArn },
  });
  const scimToken =
    process.env.AUTHENTIK_SCIM_TOKEN !== undefined
      ? pulumi.secret(process.env.AUTHENTIK_SCIM_TOKEN)
      : config.requireSecret("icScimToken");
  const icResult = createIdentityCenterAuthentik({
    authentikUrl,
    scimToken,
    icAcsUrl,
    icAudience,
    icScimUrl,
    workloadAccountId,
    managementProvider,
    icInstanceArn: config.get("icInstanceArn"),
    assignmentsEnabled: icAssignmentsEnabled,
  });
  assignmentsPending = icResult.assignmentsPending;
  adminPermissionSetArn = icResult.adminPermissionSetArn;
  viewerPermissionSetArn = icResult.viewerPermissionSetArn;
  authentikApplicationSlug = icResult.authentikApplicationSlug;
}

export const awsRegion = awsConfig.get("region") ?? "us-east-1";
export const githubOidcProviderArn = oidc.providerArn;
export const githubActionsDeployRoleArn = oidc.deployRoleArn;
export const githubActionsDeployRoleName = oidc.deployRoleName;

export const route53HostedZoneId = dnsweaver.hostedZoneId;
export const route53HostedZoneName = hostedZoneName;
export const dnsweaverPolicyArn = dnsweaver.policyArn;
export const dnsweaverUserName = dnsweaver.userName;
export const dnsweaverAccessKeyId = dnsweaver.accessKeyId;
export const dnsweaverSecretAccessKey = dnsweaver.secretAccessKey;
export const dnsweaverRolesAnywhereRoleArn = dnsweaver.rolesAnywhereRoleArn;

export const icAssignmentsPending = assignmentsPending;
export const icAdminPermissionSetArn = adminPermissionSetArn;
export const icViewerPermissionSetArn = viewerPermissionSetArn;
export const icAuthentikApplicationSlug = authentikApplicationSlug;
