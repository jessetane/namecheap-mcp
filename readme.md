# namecheap-mcp

Stdio MCP server for Namecheap domains and DNS.

## Why

Namecheap's official MCP server is broken (OAuth behind Cloudflare bot challenges, 20-minute tokens that die on concurrent calls) and raw Namecheap XML is footgun city (forgetting `EmailType` when setting a single DNS host silently wipes your MX records).

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
