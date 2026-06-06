# hcloud-security-cluster

Security-focused platform automation. **Current target:** a single Hetzner VPS running Docker Compose stacks (Traefik, PostgreSQL, Authentik, OpenBao) with persistent data on a host volume such as `/mnt/data`.

Start with [stacks/README.md](stacks/README.md). Optional GitOps for those stacks: [Doco-CD](https://github.com/kimdre/doco-cd) via [`.doco-cd.yml`](.doco-cd.yml) and [stacks/doco-cd/](stacks/doco-cd/).

The `infrastructure/` directory still contains legacy **AWS Pulumi** stacks (ECS, Aurora, NLB) for reference or migration; it is not required for the VPS layout.

OpenBao policy examples live in [bao/](bao/).
