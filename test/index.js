import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, test } from 'node:test'
import { createMcpHandler } from '../mcp.js'
import { parseXml, findNode } from '../xml.js'

let server
let baseUrl
let mockState
let lastRequests = []

function escapeXml (str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function resetState () {
	lastRequests = []
	mockState = {
		emailType: 'FWD',
		usingOurDns: true,
		locked: true,
		nameservers: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'],
		forwards: [{ mailbox: 'info', forwardTo: 'hello@example.com' }],
		contacts: {
			registrant: {
				organization: 'Acme Corp',
				firstName: 'Jane',
				lastName: 'Doe',
				address1: '123 Main St',
				city: 'New York',
				stateProvince: 'NY',
				postalCode: '10001',
				country: 'US',
				phone: '+1.2125550100',
				email: 'jane@example.com'
			},
			tech: {
				organization: 'Ops Dept',
				firstName: 'Tech',
				lastName: 'Admin',
				address1: '100 Tech Way',
				city: 'Austin',
				stateProvince: 'TX',
				postalCode: '78701',
				country: 'US',
				phone: '+1.5125550100',
				email: 'tech@example.com'
			},
			admin: {
				organization: 'Acme Corp',
				firstName: 'Admin',
				lastName: 'User',
				address1: '123 Main St',
				city: 'New York',
				stateProvince: 'NY',
				postalCode: '10001',
				country: 'US',
				phone: '+1.2125550100',
				email: 'admin@example.com'
			},
			billing: {
				organization: 'Acme Corp',
				firstName: 'Billing',
				lastName: 'User',
				address1: '123 Main St',
				city: 'New York',
				stateProvince: 'NY',
				postalCode: '10001',
				country: 'US',
				phone: '+1.2125550100',
				email: 'billing@example.com'
			}
		},
		hosts: [
			{ id: '101', name: '@', type: 'A', value: '93.184.216.34', prio: '10', ttl: '3600' },
			{ id: '102', name: '*', type: 'A', value: '93.184.216.34', prio: '10', ttl: '300' },
			{ id: '103', name: '@', type: 'TXT', value: 'v=spf1 include:_spf.google.com ~all', prio: '10', ttl: '300' }
		]
	}
}

function renderContactNode (tag, c) {
	return `<${tag}>
		<OrganizationName>${escapeXml(c.organization)}</OrganizationName>
		<FirstName>${escapeXml(c.firstName)}</FirstName>
		<LastName>${escapeXml(c.lastName)}</LastName>
		<Address1>${escapeXml(c.address1)}</Address1>
		<City>${escapeXml(c.city)}</City>
		<StateProvince>${escapeXml(c.stateProvince)}</StateProvince>
		<PostalCode>${escapeXml(c.postalCode)}</PostalCode>
		<Country>${escapeXml(c.country)}</Country>
		<Phone>${escapeXml(c.phone)}</Phone>
		<EmailAddress>${escapeXml(c.email)}</EmailAddress>
	</${tag}>`
}

before(async () => {
	resetState()
	server = http.createServer(async (req, res) => {
		const url = new URL(req.url, 'http://127.0.0.1')
		let body = ''
		for await (const chunk of req) body += chunk
		const params = req.method === 'POST'
			? Object.fromEntries(new URLSearchParams(body))
			: Object.fromEntries(url.searchParams)
		const auth = req.headers.authorization
		lastRequests.push({ method: req.method, params, auth })
		const validBearer = auth === 'Bearer test-token'
		const validDirect = params.ApiKey === 'test-api-key' && params.UserName === 'testuser' && params.ClientIp === '1.2.3.4'
		if (!validBearer && !validDirect) {
			res.writeHead(401, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ error: 'Unauthorized' }))
			return
		}
		const cmd = params.Command
		res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
		if (cmd === 'namecheap.domains.getTldList') {
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.getTldList">
		<Tlds>
			<Tld Name="com" />
			<Tld Name="im" />
			<Tld Name="co.uk" />
		</Tlds>
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.getList') {
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.getList">
		<DomainGetListResult>
			<Domain ID="100001" Name="example.com" User="testuser" Created="11/04/2026" Expires="11/04/2027" IsExpired="false" IsLocked="true" AutoRenew="true" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true" />
		</DomainGetListResult>
		<Paging>
			<TotalItems>1</TotalItems>
			<CurrentPage>1</CurrentPage>
			<PageSize>100</PageSize>
		</Paging>
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.getInfo') {
			const nsXml = mockState.nameservers.map(n => `<Nameserver>${escapeXml(n)}</Nameserver>`).join('')
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.getInfo">
		<DomainGetInfoResult Status="Ok" ID="100001" DomainName="${escapeXml(params.DomainName)}" OwnerName="testuser" IsOwner="true" IsPremium="false">
			<DomainDetails>
				<CreatedDate>11/04/2026</CreatedDate>
				<ExpiredDate>11/04/2027</ExpiredDate>
			</DomainDetails>
			<Whoisguard Enabled="True">
				<ID>900001</ID>
				<ExpiredDate>11/03/2027</ExpiredDate>
			</Whoisguard>
			<DnsDetails ProviderType="FREE" IsUsingOurDNS="${mockState.usingOurDns}" HostCount="${mockState.hosts.length}" EmailType="${mockState.emailType}">
				${nsXml}
			</DnsDetails>
		</DomainGetInfoResult>
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.getContacts') {
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.getContacts">
		<DomainContactsResult Domain="${escapeXml(params.DomainName)}">
			${renderContactNode('Registrant', mockState.contacts.registrant)}
			${renderContactNode('Tech', mockState.contacts.tech)}
			${renderContactNode('Admin', mockState.contacts.admin)}
			${renderContactNode('AuxBilling', mockState.contacts.billing)}
		</DomainContactsResult>
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.setContacts') {
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.setContacts">
		<DomainSetContactResult Domain="${escapeXml(params.DomainName)}" IsSuccess="true" />
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.create') {
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.create">
		<DomainCreateResult Domain="${escapeXml(params.DomainName)}" Registered="true" ChargedAmount="12.28" DomainID="109999999" OrderID="555" TransactionID="777" WhoisguardEnable="true" />
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.getRegistrarLock') {
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.getRegistrarLock">
		<DomainGetRegistrarLockResult Domain="${escapeXml(params.DomainName)}" RegistrarLockStatus="${mockState.locked}" />
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.setRegistrarLock') {
			mockState.locked = params.LockAction === 'LOCK'
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.setRegistrarLock">
		<DomainSetRegistrarLockResult Domain="${escapeXml(params.DomainName)}" IsSuccess="true" />
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.check') {
			const domains = params.DomainList.split(',')
			const items = domains.map(d => `<DomainCheckResult Domain="${escapeXml(d)}" Available="${d !== 'example.com'}" IsPremiumName="false" PremiumRegistrationPrice="0" IcannFee="0" />`).join('')
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.check">
		${items}
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.users.getPricing') {
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.users.getPricing">
		<UserGetPricingResult>
			<ProductType Name="domains">
				<ProductCategory Name="register">
					<Product Name="${escapeXml(params.ProductName)}">
						<Price Duration="1" DurationType="YEAR" Price="12.08" RegularPrice="15.98" YourPrice="12.08" YourAdditonalCost="0.20" Currency="USD" />
					</Product>
				</ProductCategory>
			</ProductType>
		</UserGetPricingResult>
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.users.getBalances') {
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.users.getBalances">
		<UserGetBalancesResult Currency="USD" AvailableBalance="42.50" AccountBalance="42.50" EarnedAmount="100.00" WithdrawableAmount="0.00" FundsRequiredForAutoRenew="19.33" />
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.users.address.getInfo') {
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.users.address.getInfo">
		<GetAddressInfoResult>
			<Organization>Acme Corp</Organization>
			<FirstName>Jane</FirstName>
			<LastName>Doe</LastName>
			<Address1>123 Main St</Address1>
			<City>New York</City>
			<StateProvince>NY</StateProvince>
			<Zip>10001</Zip>
			<Country>US</Country>
			<Phone>+1.2125550100</Phone>
			<EmailAddress>jane@example.com</EmailAddress>
		</GetAddressInfoResult>
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.dns.setDefault') {
			mockState.nameservers = ['dns1.registrar-servers.com', 'dns2.registrar-servers.com']
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.dns.setDefault">
		<DomainDNSSetDefaultResult Domain="${escapeXml(params.SLD)}.${escapeXml(params.TLD)}" Updated="true" />
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.dns.setCustom') {
			mockState.nameservers = params.Nameservers.split(',')
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.dns.setCustom">
		<DomainDNSSetCustomResult Domain="${escapeXml(params.SLD)}.${escapeXml(params.TLD)}" Updated="true" />
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.dns.getHosts') {
			const hostsXml = mockState.hosts.map(h =>
				`<host HostId="${escapeXml(h.id)}" Name="${escapeXml(h.name)}" Type="${escapeXml(h.type)}" Address="${escapeXml(h.value)}" MXPref="${escapeXml(h.prio)}" TTL="${escapeXml(h.ttl)}" IsActive="true" IsDDNSEnabled="false" />`
			).join('\n')
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.dns.getHosts">
		<DomainDNSGetHostsResult Domain="${escapeXml(params.SLD)}.${escapeXml(params.TLD)}" EmailType="${escapeXml(mockState.emailType)}" IsUsingOurDNS="${mockState.usingOurDns}">
			${hostsXml}
		</DomainDNSGetHostsResult>
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.dns.setHosts') {
			const nextHosts = []
			let i = 1
			while (params[`HostName${i}`] !== undefined) {
				nextHosts.push({
					id: String(200 + i),
					name: params[`HostName${i}`],
					type: params[`RecordType${i}`],
					value: params[`Address${i}`],
					prio: params[`MXPref${i}`] || '10',
					ttl: params[`TTL${i}`] || '300'
				})
				i++
			}
			mockState.hosts = nextHosts
			if (params.EmailType) {
				mockState.emailType = params.EmailType
			}
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.dns.setHosts">
		<DomainDNSSetHostsResult Domain="${escapeXml(params.SLD)}.${escapeXml(params.TLD)}" IsSuccess="true" />
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.dns.getEmailForwarding') {
			const fwds = mockState.forwards.map(f => `<Forward mailbox="${escapeXml(f.mailbox)}">${escapeXml(f.forwardTo)}</Forward>`).join('')
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.dns.getEmailForwarding">
		<DomainDNSGetEmailForwardingResult Domain="${escapeXml(params.DomainName)}">
			${fwds}
		</DomainDNSGetEmailForwardingResult>
	</CommandResponse>
</ApiResponse>`)
			return
		}
		if (cmd === 'namecheap.domains.dns.setEmailForwarding') {
			const nextFwds = []
			let i = 1
			while (params[`MailBox${i}`] !== undefined) {
				nextFwds.push({
					mailbox: params[`MailBox${i}`],
					forwardTo: params[`ForwardTo${i}`]
				})
				i++
			}
			mockState.forwards = nextFwds
			res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
	<CommandResponse Type="namecheap.domains.dns.setEmailForwarding">
		<DomainDNSSetEmailForwardingResult Domain="${escapeXml(params.DomainName)}" IsSuccess="true" />
	</CommandResponse>
</ApiResponse>`)
			return
		}
		res.end(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="ERROR">
	<Errors>
		<Error Number="1010">Unknown command ${escapeXml(cmd)}</Error>
	</Errors>
</ApiResponse>`)
	})
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
	baseUrl = `http://127.0.0.1:${server.address().port}/xml.response`
})

after(async () => {
	await new Promise(resolve => server.close(resolve))
})

test('parseXml handles CDATA blocks and literal > inside quoted attribute values', () => {
	const raw = `<?xml version="1.0"?><ApiResponse Status="OK"><host Name="@" Type="TXT" Address="v=spf1 a>b &quot;quoted&quot;" /><Note><![CDATA[raw <tag> & unescaped > content]]></Note></ApiResponse>`
	const ast = parseXml(raw)
	const host = findNode(ast, 'host')
	const note = findNode(ast, 'Note')
	assert.equal(host.attrs.Address, 'v=spf1 a>b "quoted"')
	assert.equal(note.text, 'raw <tag> & unescaped > content')
})

test('MCP JSON-RPC initialize, tools/list, and tools/call with omitted params', async () => {
	const { createRpcEngine } = createMcpHandler({ url: baseUrl, token: 'test-token' })
	const sent = []
	const rpc = createRpcEngine(data => sent.push(JSON.parse(data)))
	await rpc.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
	assert.equal(sent[0].id, 1)
	assert.equal(sent[0].result.serverInfo.name, 'namecheap-mcp')
	await rpc.receive(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }))
	assert.equal(sent[1].result.tools.length, 2)
	assert.deepEqual(sent[1].result.tools.map(t => t.name), ['domains', 'dns'])
	await rpc.receive(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call' }))
	assert.equal(sent[2].result.isError, true)
	assert.match(sent[2].result.content[0].text, /Tool name is required/)
})

test('Direct Namecheap API credential mode vs Bearer proxy mode & missing credential errors', async () => {
	resetState()
	const { client: directClient } = createMcpHandler({
		url: baseUrl,
		apiKey: 'test-api-key',
		user: 'testuser',
		clientIp: '1.2.3.4'
	})
	const bal = await directClient.domains.balances()
	assert.equal(bal.availableBalance, 42.5)
	assert.equal(lastRequests[0].auth, undefined)
	assert.equal(lastRequests[0].params.ApiKey, 'test-api-key')
	assert.equal(lastRequests[0].params.ApiUser, 'testuser')
	assert.equal(lastRequests[0].params.UserName, 'testuser')
	assert.equal(lastRequests[0].params.ClientIp, '1.2.3.4')
	const { client: noCredsClient } = createMcpHandler({})
	await assert.rejects(() => noCredsClient.domains.balances(), /Missing Namecheap credentials/)
	const { client: tokenNoUrlClient } = createMcpHandler({ token: 'only-token' })
	await assert.rejects(() => tokenNoUrlClient.domains.balances(), /NAMECHEAP_URL is required/)
})

test('domains tool: list, get, check (with multi-part TLD), set_nameservers, set_contacts, set_lock, balances', async () => {
	resetState()
	const { executeTool, client } = createMcpHandler({ url: baseUrl, token: 'test-token' })
	const listRes = await executeTool('domains', { action: 'list' })
	assert.equal(listRes.isError, undefined)
	const listData = JSON.parse(listRes.content[0].text)
	assert.equal(listData.total, 1)
	assert.equal(listData.domains[0].domain, 'example.com')
	const getRes = await executeTool('domains', { action: 'get', domain: 'example.com' })
	const getData = JSON.parse(getRes.content[0].text)
	assert.equal(getData.domain, 'example.com')
	assert.equal(getData.isLocked, true)
	assert.equal(getData.contacts.registrant.organization, 'Acme Corp')
	const checkRes = await executeTool('domains', { action: 'check', domains: ['example.com', 'newbrand.co.uk'] })
	const checkData = JSON.parse(checkRes.content[0].text)
	assert.equal(checkData.results[0].available, false)
	assert.equal(checkData.results[1].available, true)
	assert.equal(checkData.results[1].price, 12.08)
	assert.equal(checkData.results[1].icannFee, 0.2)
	const pricingRequests = lastRequests.filter(r => r.params.Command === 'namecheap.users.getPricing').map(r => r.params.ProductName)
	assert.ok(pricingRequests.includes('co.uk'))
	const missingNsRes = await executeTool('domains', { action: 'set_nameservers', domain: 'example.com' })
	assert.equal(missingNsRes.isError, true)
	assert.match(missingNsRes.content[0].text, /nameservers is required/)
	const nsRes = await executeTool('domains', {
		action: 'set_nameservers',
		domain: 'example.com',
		nameservers: ['ns1.example.com', 'ns2.example.com']
	})
	const nsData = JSON.parse(nsRes.content[0].text)
	assert.equal(nsData.updated, true)
	assert.deepEqual(mockState.nameservers, ['ns1.example.com', 'ns2.example.com'])
	const defaultNsRes = await client.domains.set_nameservers({ domain: 'example.com', nameservers: 'default' })
	assert.equal(defaultNsRes.provider, 'default')
	const partialContactRes = await client.domains.set_contacts({
		domain: 'example.com',
		contacts: {
			tech: {
				firstName: 'UpdatedTech',
				lastName: 'Person',
				address1: '500 Server Rd',
				city: 'Seattle',
				stateProvince: 'WA',
				postalCode: '98101',
				country: 'US',
				phone: '+1.2065550199',
				email: 'newtech@example.com'
			}
		}
	})
	assert.equal(partialContactRes.updated, true)
	const setContactReq = lastRequests.findLast(r => r.params.Command === 'namecheap.domains.setContacts')
	assert.equal(setContactReq.params.TechFirstName, 'UpdatedTech')
	assert.equal(setContactReq.params.RegistrantFirstName, 'Jane')
	assert.equal(setContactReq.params.AdminFirstName, 'Admin')
	assert.equal(setContactReq.params.AuxBillingFirstName, 'Billing')
	assert.equal(lastRequests.some(r => r.params.Command === 'namecheap.users.address.getInfo'), false)
	const regRes = await client.domains.register({
		domain: 'newbrand.com',
		contacts: {
			tech: mockState.contacts.tech,
			admin: mockState.contacts.admin,
			billing: mockState.contacts.billing
		}
	})
	assert.equal(regRes.registered, true)
	const createReq = lastRequests.findLast(r => r.params.Command === 'namecheap.domains.create')
	assert.equal(createReq.params.RegistrantFirstName, 'Jane')
	assert.equal(createReq.params.TechFirstName, 'Tech')
	assert.equal(lastRequests.some(r => r.params.Command === 'namecheap.users.address.getInfo'), true)
	const lockRes = await executeTool('domains', { action: 'set_lock', domain: 'example.com', locked: false })
	const lockData = JSON.parse(lockRes.content[0].text)
	assert.equal(lockData.locked, false)
	assert.equal(mockState.locked, false)
	const balRes = await executeTool('domains', { action: 'balances' })
	const balData = JSON.parse(balRes.content[0].text)
	assert.equal(balData.availableBalance, 42.5)
})

test('dns tool: get, partial update preserving TTL/prio, stale id error, MX/MXE EmailType transitions, and delete', async () => {
	resetState()
	const { executeTool, client } = createMcpHandler({ url: baseUrl, token: 'test-token' })
	const getRes = await executeTool('dns', { action: 'get', domain: 'example.com' })
	const getData = JSON.parse(getRes.content[0].text)
	assert.equal(getData.emailType, 'FWD')
	assert.equal(getData.records.length, 3)
	assert.equal(getData.emailForwarding.length, 1)
	// Updating @ A record without specifying ttl preserves its existing 3600 TTL
	const setRes = await executeTool('dns', {
		action: 'set',
		domain: 'example.com',
		records: [
			{ type: 'A', name: '@', value: '1.2.3.4' },
			{ type: 'MX', name: '@', value: 'smtp.google.com.', prio: 1, ttl: 300 },
			{ type: 'TXT', name: '@', value: 'google-site-verification=abc123', ttl: 300 }
		]
	})
	assert.equal(setRes.isError, undefined)
	const setData = JSON.parse(setRes.content[0].text)
	assert.equal(setData.emailType, 'MX')
	assert.equal(setData.records.length, 5)
	const apexA = setData.records.find(r => r.type === 'A' && r.name === '@')
	assert.equal(apexA.value, '1.2.3.4')
	assert.equal(apexA.ttl, 3600)
	// Updating MX record with same value without prio matches existing MX record and preserves prio=1
	const mxUpdate = await client.dns.set({
		domain: 'example.com',
		records: [{ type: 'MX', name: '@', value: 'smtp.google.com.', ttl: 900 }]
	})
	const mxRec = mxUpdate.records.find(r => r.type === 'MX')
	assert.equal(mxRec.prio, 1)
	assert.equal(mxRec.ttl, 900)
	// Stale record id fails loud instead of silently appending
	await assert.rejects(
		() => client.dns.set({ domain: 'example.com', records: [{ id: '999999', type: 'A', name: '@', value: '9.9.9.9' }] }),
		/DNS record with id "999999" not found/
	)
	// Delete MX record demotes EmailType from MX to NONE
	const delMx = await client.dns.delete({
		domain: 'example.com',
		records: [{ type: 'MX', name: '@' }]
	})
	assert.equal(delMx.deletedCount, 1)
	assert.equal(delMx.emailType, 'NONE')
	// Adding MXE record promotes EmailType to MXE
	const addMxe = await client.dns.set({
		domain: 'example.com',
		records: [{ type: 'MXE', name: '@', value: '10.20.30.40' }]
	})
	assert.equal(addMxe.emailType, 'MXE')
	// Replace mode without MX/MXE demotes EmailType from MXE to NONE
	const replaceRes = await client.dns.set({
		domain: 'example.com',
		mode: 'replace',
		records: [{ type: 'A', name: '@', value: '1.2.3.4' }]
	})
	assert.equal(replaceRes.emailType, 'NONE')
	assert.equal(replaceRes.records.length, 1)
})

test('splitDomain and domains.check support multi-part TLDs and reject subdomains', async () => {
	resetState()
	const { client } = createMcpHandler({ url: baseUrl, token: 'test-token' })
	const split = await client.splitDomain('example.co.uk')
	assert.deepEqual(split, { domain: 'example.co.uk', sld: 'example', tld: 'co.uk' })
	await assert.rejects(() => client.splitDomain('sub.example.com'), /Invalid registrable domain/)
	await assert.rejects(() => client.splitDomain('deep.sub.example.co.uk'), /Invalid registrable domain/)
	await assert.rejects(() => client.domains.check({ domains: ['sub.example.com'] }), /Invalid registrable domain/)
})
