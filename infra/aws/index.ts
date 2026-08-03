import * as pulumi from "@pulumi/pulumi";
import { createGithubOidc } from "./githubOidc";
import { createRoute53Dnsweaver } from "./route53Dnsweaver";

const config = new pulumi.Config();
const awsConfig = new pulumi.Config("aws");

const githubOrg = config.get("githubOrg") ?? "GoodMannersHosting";
const githubRepo = config.get("githubRepo") ?? "cloud-security-cluster";
const allowedRefs = config.getObject<string[]>("allowedRefs") ?? [
  "refs/heads/main",
];
const hostedZoneName =
  config.get("hostedZoneName") ?? "goodmanners.services";
const existingOidcProviderArn = config.get("githubOidcProviderArn");
const rolesAnywhereTrustAnchorArn = config.get(
  "rolesAnywhereTrustAnchorArn",
);

const oidc = createGithubOidc({
  githubOrg,
  githubRepo,
  allowedRefs,
  existingProviderArn: existingOidcProviderArn,
});

const dnsweaver = createRoute53Dnsweaver({
  hostedZoneName,
  rolesAnywhereTrustAnchorArn,
});

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
