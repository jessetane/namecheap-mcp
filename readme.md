# namecheap-mcp

Stdio MCP server for Namecheap domains and DNS.

## Tools

* **`domains`**: `list`, `get`, `check`, `set_nameservers`, `set_contacts`, `set_lock`, `register`, `renew`, `balances`
* **`dns`**: `get`, `set` (safe read-merge-write with automatic `EmailType` promotion/demotion, or `mode: "replace"`), `delete`, `set_email_forwarding`

## Setup

```sh
$ npm i
$ cp .env.example .env
```

Configure either **Direct Namecheap API** credentials or a **Bearer Proxy** in `.env` (or via `env` in `mcp_config.json`):

* **Direct API mode**: set `NAMECHEAP_API_KEY`, `NAMECHEAP_USER`, and `NAMECHEAP_CLIENT_IP` (plus optional `NAMECHEAP_API_USER` and `NAMECHEAP_URL`, which defaults to `https://api.namecheap.com/xml.response`).
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
