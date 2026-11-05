# namecheap-mcp

Stdio MCP server for Namecheap domains and DNS.

## Why

Auth on Namecheap's official MCP server is broken (OAuth discovery points at `www.namecheap.com` instead of `mcp.namecheap.com`, and single-use refresh tokens expire after ~24 hours or on concurrent refreshes), and `setHosts` is a footgun that overwrites the entire DNS zone (and resets `EmailType` if omitted) when you just want to patch a record.

## How

* Zero-dependency stdio MCP server built on Namecheap's XML API.
* Compresses the entire domain and DNS surface into 2 ergonomic tools (`domains` and `dns`) instead of 15+ scattered endpoints.
* Safe read-merge-write DNS updates (`set` / `delete` by record ID or `{ type, name }`) that automatically preserve existing records, TTLs, and `EmailType` (`MX` / `MXE` / `FWD`) unless `mode: "replace"` is explicitly requested.
* Works directly with Namecheap XML API credentials or through a static-IP bearer proxy (like [jump](https://github.com/jessetane/jump)) so roaming networks never trip Namecheap's IP whitelist.

## Tools

* **`domains`**: `list`, `get`, `check`, `set_nameservers`, `set_contacts`, `set_lock`, `register`, `renew`, `balances`
* **`dns`**: `get`, `set` (safe read-merge-write with automatic `EmailType` promotion/demotion, or `mode: "replace"`), `delete`, `set_email_forwarding`

## Setup

```sh
$ npm i
$ cp .env.example .env
```

Configure either **Direct Namecheap API** credentials or a **Bearer Proxy** in `.env` (or via `env` in `mcp_config.json`):

* **Direct API mode**: set `NAMECHEAP_API_KEY`, `NAMECHEAP_USER`, and `NAMECHEAP_CLIENT_IP` (plus optional `NAMECHEAP_URL`, which defaults to `https://api.namecheap.com/xml.response`).
* **Bearer Proxy mode**: set `NAMECHEAP_URL` and `NAMECHEAP_TOKEN`.

```json
{
	"mcpServers": {
		"namecheap": {
			"command": "node",
			"args": ["/path/to/namecheap-mcp/index.js"]
		}
	}
}
```

## Test

```sh
$ npm test
```

## License

MIT
