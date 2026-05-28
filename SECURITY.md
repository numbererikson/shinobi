# Security Policy

## Supported Versions

The latest released minor (currently v0.1.x) is supported with security
patches. Earlier versions are not.

## Reporting a Vulnerability

If you've found a security issue in Shinobi, **please do not open a public
GitHub issue**. Instead, email:

```
contact@shinobi-apps.hr
```

Include:

- A description of the issue and its impact
- Steps to reproduce (proof-of-concept if you have one)
- Affected version(s)

You can expect:

- An acknowledgement within **5 business days**
- A status update within **10 business days**
- A patch released within **30 days** for confirmed, exploitable issues — or
  a clear explanation if more time is required

## Scope

**In scope:**

- The Shinobi MCP server (this repo)
- The Hono-served dashboard and its API endpoints
- The Cloudflare Worker relay (`relay-worker/`)
- The plugin discovery mechanism (`~/.shinobi/plugins/`, `@shinobi/plugin-*`)
- The npm distribution and `prepare` script

**Not in scope:**

- Vulnerabilities in third-party dependencies — please report those to the
  dependency's maintainer. We pick up patches through normal dependency
  updates and `npm audit fix`.
- Local-attack scenarios that require shell access to the user's machine
  (Shinobi binds to loopback by default; we assume the host is trusted).
- Bugs that are not security-relevant — please file those as regular
  GitHub issues.

## Recognition

If you would like public credit after coordinated disclosure, we will add
you to an acknowledgements section in this file. Anonymous reporting is
fine — your call.

## Threat Model

Shinobi is a local-first tool. The default deployment assumes:

- One user, one machine, loopback-only dashboard binding
- Trusted MCP client (the user's own AI agent)
- Local filesystem and SQLite store are not adversary-accessible

When the dashboard binds to a non-loopback address (`SHINOBI_DASHBOARD_HOST`
not in `127.0.0.1`/`localhost`), token auth is auto-enabled. The token is
generated to `~/.shinobi/dashboard-token`.

The Cloudflare Worker relay uses a shared HMAC token
(`SHINOBI_RELAY_TOKEN`); WebSocket connections with mismatched tokens are
rejected. Workspace separation is enforced via Durable Object naming.

If you operate Shinobi outside this threat model (multi-user hosted SaaS,
exposed dashboard without tunneling, etc.), please review the relevant
docs and consider whether additional hardening (reverse proxy, WAF, audit
logging) is appropriate for your deployment.
