import * as hcloud from "@pulumi/hcloud";

// Server - ID: 124406258, cpx41 (8C/16G) in hil, ubuntu-24.04
const secHilProd1 = new hcloud.Server("sec-hil-prod-1", {
    name: "sec-hil-prod-1",
    serverType: "cpx41",
    location: "hil",
    image: "ubuntu-24.04",
}, { protect: true });

// Firewall - ID: 10731494, applied to server via applyTos (manages attachment)
const allowSaneTrafficIn = new hcloud.Firewall("allow-sane-traffic-in", {
    name: "allow-sane-traffic-in",
    applyTos: [{ server: secHilProd1.id.apply(id => Number(id)) }],
    rules: [
        { direction: "in", protocol: "tcp", port: "22", sourceIps: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "icmp", sourceIps: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "443", sourceIps: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "udp", port: "443", sourceIps: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "80", sourceIps: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "udp", port: "53", sourceIps: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "53", sourceIps: ["0.0.0.0/0", "::/0"] },
    ],
}, { protect: true });

// Primary IPs - auto-created with server (autoDelete=true), now explicitly managed
const secHilProd1Ipv4 = new hcloud.PrimaryIp("sec-hil-prod-1-ipv4", {
    type: "ipv4",
    autoDelete: true,
    assigneeId: secHilProd1.id.apply(id => Number(id)),
    assigneeType: "server",
}, { protect: true });

const secHilProd1Ipv6 = new hcloud.PrimaryIp("sec-hil-prod-1-ipv6", {
    type: "ipv6",
    autoDelete: true,
    assigneeId: secHilProd1.id.apply(id => Number(id)),
    assigneeType: "server",
}, { protect: true });

// Volumes - 20GB xfs each, attached via serverId
const secHilAuthentikData = new hcloud.Volume("sec-hil-authentik-data", {
    name: "sec-hil-1-authentik",
    size: 20,
    location: "hil",
    serverId: secHilProd1.id.apply(id => Number(id)),
}, { protect: true });

const secHilOpenbaoData = new hcloud.Volume("sec-hil-openbao-data", {
    name: "sec-hil-1-openbao",
    size: 20,
    location: "hil",
    serverId: secHilProd1.id.apply(id => Number(id)),
}, { protect: true });

// Exports for other stacks or CLI reference
export const serverIpV4 = secHilProd1Ipv4.ipAddress;
export const serverIpV6 = secHilProd1Ipv6.ipNetwork;
export const serverId = secHilProd1.id;
