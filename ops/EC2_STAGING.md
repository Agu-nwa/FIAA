# EC2 staging deployment

This configuration runs the FIAA application, PostgreSQL 17 and Caddy on one EC2 instance. It is intended for continuing development and testing, not an approved production launch. Search-engine indexing remains disabled and the runtime uses development mode so the unfinished payment adapter does not masquerade as production-ready checkout.

## 1. Create the instance

Use Ubuntu 24.04 LTS with at least 2 GB RAM. In the instance security group allow:

- TCP 22 from your own IP only;
- TCP 80 from anywhere;
- TCP 443 and UDP 443 from anywhere when using a domain.

Do not expose PostgreSQL port 5432.

## 2. Install Docker and obtain the repository

Install Docker Engine and its Compose plugin using Docker's official Ubuntu instructions. Add the deployment user to the `docker` group, reconnect, then clone the private FIAA repository into `/opt/fiaa-evolution` or another dedicated application directory.

## 3. Configure secrets

From the repository directory:

```sh
cp .env.ec2.example .env.ec2
openssl rand -base64 36
openssl rand -base64 36
```

Put the first generated value in `POSTGRES_PASSWORD` and the second in `COOKIE_SECRET`.

For initial IP-only testing, set:

```dotenv
SITE_ADDRESS=:80
PUBLIC_WEB_ORIGIN=http://EC2_PUBLIC_IP
```

For a staging domain whose DNS A record points at the instance, set both values to the hostname. Caddy will request and renew HTTPS automatically:

```dotenv
SITE_ADDRESS=staging.fiaaevolution.com
PUBLIC_WEB_ORIGIN=https://staging.fiaaevolution.com
```

## 4. First deployment

```sh
chmod +x scripts/deploy-ec2.sh
./scripts/deploy-ec2.sh
```

The database migrations in `database/` are applied automatically only when the PostgreSQL volume is first created.

## 5. Deploy later updates

Commit and push changes from the development machine. On EC2, run:

```sh
cd /opt/fiaa-evolution
./scripts/deploy-ec2.sh
```

This fast-forwards the checkout, rebuilds the application image, restarts changed containers and verifies readiness. Database changes added after the first deployment must be applied deliberately before restarting the application; do not delete the database volume to rerun migrations.

## Operations

```sh
docker compose --env-file .env.ec2 -f docker-compose.ec2.yml ps
docker compose --env-file .env.ec2 -f docker-compose.ec2.yml logs -f app
docker compose --env-file .env.ec2 -f docker-compose.ec2.yml restart app
```

Back up the PostgreSQL volume before schema changes. Keep `.env.ec2`, database dumps and private SSH keys off Git.
