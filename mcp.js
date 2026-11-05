import RpcEngine from 'rpc-engine'
import { createClient } from './client.js'

const contactSchema = {
	type: 'object',
	properties: {
		firstName: { type: 'string' },
		lastName: { type: 'string' },
		organization: { type: 'string' },
		jobTitle: { type: 'string' },
		address1: { type: 'string' },
		address2: { type: 'string' },
		city: { type: 'string' },
		stateProvince: { type: 'string' },
		postalCode: { type: 'string' },
		country: { type: 'string', description: 'Two-letter ISO country code (e.g. "US").' },
		phone: { type: 'string', description: 'Phone in +CountryCode.Number format (e.g. "+1.2125550100").' },
		phoneExt: { type: 'string' },
		fax: { type: 'string' },
		email: { type: 'string' }
	},
	required: ['firstName', 'lastName', 'address1', 'city', 'stateProvince', 'postalCode', 'country', 'phone', 'email']
}

export const tools = [
	{
		name: 'domains',
		description: 'Manage Namecheap domain portfolio, availability & pricing checks, registration, renewal, nameservers, contacts, transfer lock, and account balances.',
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: [
						'list',
						'get',
						'check',
						'set_nameservers',
						'set_contacts',
						'set_lock',
						'register',
						'renew',
						'balances'
					],
					description: 'Domain action to perform.'
				},
				domain: {
					type: 'string',
					description: 'Target domain name (for get, set_nameservers, set_contacts, set_lock, register, renew).'
				},
				domains: {
					type: 'array',
					items: { type: 'string' },
					description: 'List of domain names to check availability and pricing for (action: "check").'
				},
				nameservers: {
					oneOf: [
						{ type: 'string', description: 'Pass "default" to switch to Namecheap BasicDNS, or a comma-separated list of custom nameservers.' },
						{ type: 'array', items: { type: 'string' }, description: 'Array of 2–12 custom nameserver hostnames.' }
					]
				},
				locked: {
					type: 'boolean',
					description: 'Whether registrar transfer lock should be enabled (action: "set_lock").'
				},
				years: {
					type: 'integer',
					description: 'Number of years for register or renew (default: 1).'
				},
				whoisGuard: {
					type: 'boolean',
					description: 'Enable free WhoisGuard privacy on registration (default: true).'
				},
				promoCode: {
					type: 'string',
					description: 'Optional promotional coupon code for register or renew.'
				},
				contacts: {
					type: 'object',
					description: 'Contact details for register or set_contacts. On set_contacts, omitted roles preserve existing domain contacts; on register, omitted roles fall back to registrant or account primary address.',
					properties: {
						registrant: contactSchema,
						tech: contactSchema,
						admin: contactSchema,
						billing: contactSchema
					}
				},
				page: {
					type: 'integer',
					description: 'Page number for list (default: 1).'
				},
				pageSize: {
					type: 'integer',
					description: 'Items per page for list (10–100, default: 100).'
				},
				sortBy: {
					type: 'string',
					enum: ['NAME', 'NAME_DESC', 'EXPIRE', 'EXPIRE_DESC', 'CREATED', 'CREATED_DESC'],
					description: 'Sort order for list.'
				},
				searchTerm: {
					type: 'string',
					description: 'Filter domain list by substring.'
				}
			},
			required: ['action']
		}
	},
	{
		name: 'dns',
		description: 'Read, add/update (safe read-merge-write), or delete DNS host records and email forwarding settings on a Namecheap domain.',
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['get', 'set', 'delete', 'set_email_forwarding'],
					description: 'DNS action: "get" lists records; "set" safely merges/updates records (or replaces zone when mode="replace"); "delete" removes matching records; "set_email_forwarding" configures email forwarding rules.'
				},
				domain: {
					type: 'string',
					description: 'Target domain name (e.g. "example.com").'
				},
				records: {
					type: 'array',
					description: 'DNS records to add/update (for "set") or matchers to remove (for "delete").',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string', description: 'Optional HostId to target a specific existing record.' },
							type: {
								type: 'string',
								enum: ['A', 'AAAA', 'CNAME', 'ALIAS', 'MX', 'MXE', 'TXT', 'NS', 'CAA', 'SRV', 'URL', 'URL301', 'FRAME'],
								description: 'DNS record type.'
							},
							name: {
								type: 'string',
								description: 'Host/subdomain name relative to the domain ("@" for apex, "*" for wildcard, "www", etc.).'
							},
							value: {
								type: 'string',
								description: 'Record target/value (IP address, target hostname, TXT value, CAA string, etc.).'
							},
							prio: {
								type: 'integer',
								description: 'MX priority / preference (default: 10).'
							},
							ttl: {
								type: 'integer',
								description: 'TTL in seconds (60–60000, default: 300).'
							}
						}
					}
				},
				mode: {
					type: 'string',
					enum: ['merge', 'replace'],
					description: 'For action="set": "merge" (default) preserves existing records; "replace" overwrites the entire zone with the provided records.'
				},
				upsert: {
					type: 'boolean',
					description: 'For action="set" in merge mode: when true (default), updating a single-target record (A, AAAA, CNAME, ALIAS, URL, URL301, FRAME) with the same (type, name) replaces its existing value in-place instead of adding a second record.'
				},
				emailType: {
					type: 'string',
					enum: ['MX', 'MXE', 'FWD', 'OX', 'GMAIL', 'NONE'],
					description: 'Optional mail routing mode override. Automatically set to "MX" or "MXE" when MX/MXE records are present.'
				},
				forwards: {
					type: 'array',
					description: 'Email forwarding rules for action="set_email_forwarding".',
					items: {
						type: 'object',
						properties: {
							mailbox: { type: 'string', description: 'Mailbox prefix (e.g. "info" or "*" for catch-all).' },
							forwardTo: { type: 'string', description: 'Destination email address.' }
						},
						required: ['mailbox', 'forwardTo']
					}
				}
			},
			required: ['action', 'domain']
		}
	}
]

export function createMcpHandler (clientOpts = {}) {
	const client = createClient(clientOpts)
	async function executeTool (name, args = {}) {
		try {
			if (!name) throw new Error('Tool name is required')
			const group = client[name]
			if (!group || typeof group !== 'object') {
				throw new Error(`Unknown tool: ${name}`)
			}
			const fn = group[args.action]
			if (typeof fn !== 'function') {
				throw new Error(`Unknown ${name} action: ${args.action}`)
			}
			const result = await fn(args)
			return {
				content: [{ type: 'text', text: JSON.stringify(result, null, '\t') }]
			}
		} catch (err) {
			return {
				isError: true,
				content: [{ type: 'text', text: err.message }]
			}
		}
	}
	function createRpcEngine (send) {
		return new RpcEngine({
			objectMode: true,
			deserialize: line => JSON.parse(line),
			serialize: msg => {
				const payload = typeof msg === 'object' && !msg?.jsonrpc
					? { ...msg, jsonrpc: '2.0' }
					: msg
				return JSON.stringify(payload)
			},
			send,
			methods: {
				initialize: params => ({
					protocolVersion: params?.protocolVersion || '2025-06-18',
					capabilities: { tools: {} },
					serverInfo: {
						name: 'namecheap-mcp',
						version: '0.1.0'
					}
				}),
				'notifications/initialized': () => {},
				ping: () => ({}),
				'tools/list': () => ({ tools }),
				'tools/call': ({ name, arguments: args } = {}) => executeTool(name, args)
			}
		})
	}
	return {
		client,
		tools,
		executeTool,
		createRpcEngine
	}
}
