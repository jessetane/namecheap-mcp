# namecheap-mcp

Stdio MCP server for Namecheap domains and DNS.

## Why

Namecheap's official MCP server auth is broken (OAuth discovery points at `www.namecheap.com` instead of `mcp.namecheap.com`, single-use refresh tokens expire after ~24 hours or on concurrent refreshes), and `setHosts` is a footgun that overwrites the entire DNS zone (and resets `EmailType` if omitted) when you just want to patch one record.

## How

* Zero-dependency stdio MCP server built on Namecheap's XML API.
* Compresses the entire domain and DNS surface into 2 ergonomic tools (`domains` and `dns`) instead of 15+ scattered endpoints.
* Safe read-merge-write DNS updates (`set` / `delete` by record ID or `{ type, name }`) that automatically preserve existing records, TTLs, and `EmailType` (`MX` / `MXE` / `FWD`) unless `mode: "replace"` is explicitly requested.
* Works directly with Namecheap XML API credentials or through a static-IP bearer proxy (like [jump](https://github.com/jessetane/jump)) so roaming networks never trip Namecheap's IP whitelist.

## Tools

* **`domains`**
	* `list` - List domains in account with paging and search.
	* `get` - Get domain details, lock state, nameservers, WhoisGuard, and contacts.
	* `check` - Check availability and pricing across standard and premium TLDs.
	* `set_nameservers` - Switch between Namecheap BasicDNS (`default: true`) and custom nameservers.
	* `set_contacts` - Update Registrant, Tech, Admin, and AuxBilling contacts.
	* `set_lock` - Lock or unlock registrar transfer lock.
	* `register` - Register a new domain (auto-fills contacts from an existing domain when omitted).
	* `renew` - Renew a domain.
	* `balances` - Get account balances.
* **`dns`**
	* `get` - List DNS host records, `emailType`, and email forwarding rules.
	* `set` - Safe read-merge-write DNS updates (with automatic `EmailType` promotion/demotion, or `mode: "replace"`).
	* `delete` - Delete specific DNS host records by `id` or `{ type, name, value }`.
	* `set_email_forwarding` - Configure mailbox forwarding rules.

## Usage

```sh
$ npm i
$ cp .env.example .env
```

Configure either **Direct Namecheap API** credentials or a **Bearer Proxy** in `.env` (or via `env` in `mcp_config.json`):

* **Direct API mode**
	* `NAMECHEAP_API_KEY` - Namecheap XML API key.
	* `NAMECHEAP_USER` - Namecheap username.
	* `NAMECHEAP_CLIENT_IP` - Whitelisted client IPv4 address.
	* `NAMECHEAP_URL` *(optional)* - Defaults to `https://api.namecheap.com/xml.response`.
* **Bearer Proxy mode**
	* `NAMECHEAP_URL` - Proxy endpoint URL.
	* `NAMECHEAP_TOKEN` - Proxy bearer token.

```json
{
	"mcpServers": {
		"namecheap": {
			"command": "npx",
			"args": ["-y", "github:jessetane/namecheap-mcp"]
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
