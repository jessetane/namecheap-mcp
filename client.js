import { domainToASCII } from 'node:url'
import { parseXml, findNode, findNodes, childText } from './xml.js'

const DEFAULT_URL = 'https://api.namecheap.com/xml.response'
const SINGLE_VALUE_TYPES = new Set(['A', 'AAAA', 'CNAME', 'ALIAS', 'URL', 'URL301', 'FRAME'])

function parseBool (val) {
	return String(val).toLowerCase() === 'true'
}

function formatContactFromXml (node) {
	if (!node) return null
	return {
		organization: childText(node, 'OrganizationName') || childText(node, 'Organization') || '',
		jobTitle: childText(node, 'JobTitle') || '',
		firstName: childText(node, 'FirstName') || '',
		lastName: childText(node, 'LastName') || '',
		address1: childText(node, 'Address1') || '',
		address2: childText(node, 'Address2') || '',
		city: childText(node, 'City') || '',
		stateProvince: childText(node, 'StateProvince') || '',
		postalCode: childText(node, 'PostalCode') || childText(node, 'Zip') || '',
		country: childText(node, 'Country') || '',
		phone: childText(node, 'Phone') || '',
		phoneExt: childText(node, 'PhoneExt') || '',
		fax: childText(node, 'Fax') || '',
		email: childText(node, 'EmailAddress') || ''
	}
}

function buildContactParams (contacts = {}, fallback = null) {
	const roleMap = [
		['Registrant', 'registrant'],
		['Tech', 'tech'],
		['Admin', 'admin'],
		['AuxBilling', 'billing']
	]
	const isRoleMap = fallback && typeof fallback === 'object' && !('firstName' in fallback)
	const params = {}
	for (const [prefix, key] of roleMap) {
		const fallbackRole = isRoleMap ? fallback[key] : fallback
		const src = contacts[key] || fallbackRole || contacts.registrant
		if (!src) {
			throw new Error(`Missing contact details for ${key}`)
		}
		params[`${prefix}FirstName`] = src.firstName
		params[`${prefix}LastName`] = src.lastName
		params[`${prefix}Address1`] = src.address1
		if (src.address2) params[`${prefix}Address2`] = src.address2
		params[`${prefix}City`] = src.city
		params[`${prefix}StateProvince`] = src.stateProvince
		params[`${prefix}PostalCode`] = src.postalCode
		params[`${prefix}Country`] = src.country
		params[`${prefix}Phone`] = src.phone
		if (src.phoneExt) params[`${prefix}PhoneExt`] = src.phoneExt
		if (src.fax) params[`${prefix}Fax`] = src.fax
		params[`${prefix}EmailAddress`] = src.email
		if (src.organization) params[`${prefix}OrganizationName`] = src.organization
		if (src.jobTitle) params[`${prefix}JobTitle`] = src.jobTitle
	}
	return params
}

function normalizeRecordInput (rec) {
	const out = {
		type: String(rec.type || '').trim().toUpperCase(),
		name: String(rec.name ?? '@').trim() || '@',
		value: String(rec.value ?? '').trim()
	}
	if (rec.id !== undefined && rec.id !== null && rec.id !== '') {
		out.id = String(rec.id)
	}
	if (rec.prio !== undefined && rec.prio !== null) {
		out.prio = Number(rec.prio)
	}
	if (rec.ttl !== undefined && rec.ttl !== null) {
		out.ttl = Number(rec.ttl)
	}
	return out
}

function normalizeValueForCompare (type, value) {
	const str = String(value || '').trim()
	if (type === 'TXT') return str
	return str.toLowerCase().replace(/\.$/, '')
}

function recordsMatchExact (a, b) {
	if (a.type.toUpperCase() !== b.type.toUpperCase()) return false
	if (a.name.toLowerCase() !== b.name.toLowerCase()) return false
	const type = a.type.toUpperCase()
	if (normalizeValueForCompare(type, a.value) !== normalizeValueForCompare(type, b.value)) return false
	if ((type === 'MX' || type === 'MXE') && b.prio !== undefined && Number(a.prio) !== Number(b.prio)) return false
	return true
}

function resolveEmailType (records, currentEmailType, explicitEmailType) {
	if (explicitEmailType) return explicitEmailType
	if (records.some(r => r.type.toUpperCase() === 'MXE')) return 'MXE'
	if (records.some(r => r.type.toUpperCase() === 'MX')) return 'MX'
	if (currentEmailType === 'MX' || currentEmailType === 'MXE') return 'NONE'
	return currentEmailType
}

async function getPrimaryAddress (call) {
	const xml = await call('namecheap.users.address.getInfo', { AddressId: '0' })
	const info = findNode(xml, 'GetAddressInfoResult')
	return formatContactFromXml(info)
}

async function getDomainContacts (call, domain) {
	const contactsXml = await call('namecheap.domains.getContacts', { DomainName: domain })
	const contactsNode = findNode(contactsXml, 'DomainContactsResult')
	return {
		registrant: formatContactFromXml(findNode(contactsNode, 'Registrant')),
		tech: formatContactFromXml(findNode(contactsNode, 'Tech')),
		admin: formatContactFromXml(findNode(contactsNode, 'Admin')),
		billing: formatContactFromXml(findNode(contactsNode, 'AuxBilling'))
	}
}

async function writeHosts (call, { sld, tld, emailType, records }) {
	const params = {
		SLD: sld,
		TLD: tld,
		EmailType: emailType
	}
	records.forEach((rec, i) => {
		const idx = i + 1
		params[`HostName${idx}`] = rec.name
		params[`RecordType${idx}`] = rec.type
		params[`Address${idx}`] = rec.value
		params[`MXPref${idx}`] = String(rec.prio ?? 10)
		params[`TTL${idx}`] = String(rec.ttl ?? 300)
	})
	const xml = await call('namecheap.domains.dns.setHosts', params, 'POST')
	const resNode = findNode(xml, 'DomainDNSSetHostsResult')
	if (!parseBool(resNode.attrs.IsSuccess)) {
		throw new Error(`Namecheap setHosts returned IsSuccess=false for ${sld}.${tld}`)
	}
}

export function createClient (opts = {}) {
	const fetchImpl = opts.fetch || globalThis.fetch
	let cachedMultiPartTlds = null
	async function call (command, params = {}, method = 'GET') {
		const token = opts.token || process.env.NAMECHEAP_TOKEN || ''
		const apiKey = opts.apiKey || process.env.NAMECHEAP_API_KEY || ''
		const configuredUrl = opts.url || process.env.NAMECHEAP_URL || ''
		const cleanParams = {}
		const headers = {}
		let baseUrl
		if (token) {
			if (!configuredUrl) {
				throw new Error('NAMECHEAP_URL is required when using NAMECHEAP_TOKEN proxy mode')
			}
			baseUrl = configuredUrl
			headers.Authorization = `Bearer ${token}`
		} else if (apiKey) {
			const user = opts.user || process.env.NAMECHEAP_USER || ''
			const apiUser = opts.apiUser || process.env.NAMECHEAP_API_USER || user
			const clientIp = opts.clientIp || process.env.NAMECHEAP_CLIENT_IP || ''
			if (!user || !clientIp) {
				throw new Error('NAMECHEAP_USER and NAMECHEAP_CLIENT_IP are required when using NAMECHEAP_API_KEY')
			}
			baseUrl = configuredUrl || DEFAULT_URL
			cleanParams.ApiUser = apiUser
			cleanParams.ApiKey = apiKey
			cleanParams.UserName = user
			cleanParams.ClientIp = clientIp
		} else {
			throw new Error('Missing Namecheap credentials: set NAMECHEAP_API_KEY, NAMECHEAP_USER, and NAMECHEAP_CLIENT_IP (or NAMECHEAP_URL and NAMECHEAP_TOKEN for proxy mode)')
		}
		cleanParams.Command = command
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== null && v !== '') {
				cleanParams[k] = String(v)
			}
		}
		let targetUrl = baseUrl
		let body
		if (method === 'POST') {
			headers['Content-Type'] = 'application/x-www-form-urlencoded'
			body = new URLSearchParams(cleanParams).toString()
		} else {
			const u = new URL(baseUrl)
			for (const [k, v] of Object.entries(cleanParams)) {
				u.searchParams.set(k, v)
			}
			targetUrl = u.toString()
		}
		const res = await fetchImpl(targetUrl, { method, headers, body })
		const text = await res.text()
		if (!res.ok && !text.trim().startsWith('<')) {
			let msg = text
			try {
				const parsed = JSON.parse(text)
				msg = parsed.error || text
			} catch {}
			throw new Error(`Namecheap HTTP error (${res.status}): ${msg}`)
		}
		const xml = parseXml(text)
		const status = (xml.attrs.Status || '').toUpperCase()
		if (status !== 'OK') {
			const errNodes = findNodes(findNode(xml, 'Errors'), 'Error')
			const msg = errNodes.map(e => e.attrs.Number ? `[${e.attrs.Number}] ${e.text}` : e.text).join('; ') || `Namecheap command ${command} failed`
			throw new Error(msg)
		}
		return xml
	}
	async function splitDomain (rawDomain) {
		const ascii = domainToASCII(String(rawDomain || '').trim().toLowerCase().replace(/\.$/, ''))
		const parts = ascii.split('.').filter(Boolean)
		if (parts.length < 2) {
			throw new Error(`Invalid domain name: ${rawDomain}`)
		}
		if (parts.length === 2) {
			return { domain: ascii, sld: parts[0], tld: parts[1] }
		}
		if (!cachedMultiPartTlds) {
			const xml = await call('namecheap.domains.getTldList')
			const tlds = findNodes(xml, 'Tld').map(n => (n.attrs.Name || '').toLowerCase()).filter(t => t.includes('.'))
			tlds.sort((a, b) => b.split('.').length - a.split('.').length || b.length - a.length)
			cachedMultiPartTlds = tlds
		}
		for (const candidate of cachedMultiPartTlds) {
			const suffix = `.${candidate}`
			if (ascii.endsWith(suffix)) {
				const prefix = ascii.slice(0, -suffix.length)
				if (prefix && !prefix.includes('.')) {
					return { domain: ascii, sld: prefix, tld: candidate }
				}
			}
		}
		throw new Error(`Invalid registrable domain "${rawDomain}": pass the root domain (subdomains belong in record.name)`)
	}
	async function list ({ page = 1, pageSize = 100, sortBy, searchTerm, listType } = {}) {
		const xml = await call('namecheap.domains.getList', {
			Page: page,
			PageSize: pageSize,
			SortBy: sortBy,
			SearchTerm: searchTerm,
			ListType: listType
		})
		const domains = findNodes(xml, 'Domain').map(d => ({
			id: d.attrs.ID,
			domain: d.attrs.Name,
			user: d.attrs.User,
			created: d.attrs.Created,
			expires: d.attrs.Expires,
			isExpired: parseBool(d.attrs.IsExpired),
			isLocked: parseBool(d.attrs.IsLocked),
			autoRenew: parseBool(d.attrs.AutoRenew),
			whoisGuard: d.attrs.WhoisGuard,
			isPremium: parseBool(d.attrs.IsPremium),
			usingOurDns: parseBool(d.attrs.IsOurDNS)
		}))
		const paging = findNode(xml, 'Paging')
		return {
			domains,
			total: Number(childText(paging, 'TotalItems') || domains.length),
			page: Number(childText(paging, 'CurrentPage') || page),
			pageSize: Number(childText(paging, 'PageSize') || pageSize)
		}
	}
	async function get (arg) {
		const rawDomain = typeof arg === 'object' && arg !== null ? arg.domain : arg
		if (!rawDomain) throw new Error('domain is required')
		const { domain } = await splitDomain(rawDomain)
		const [infoXml, contacts, lockXml] = await Promise.all([
			call('namecheap.domains.getInfo', { DomainName: domain }),
			getDomainContacts(call, domain),
			call('namecheap.domains.getRegistrarLock', { DomainName: domain })
		])
		const info = findNode(infoXml, 'DomainGetInfoResult')
		const details = findNode(info, 'DomainDetails')
		const wg = findNode(info, 'Whoisguard')
		const dns = findNode(info, 'DnsDetails')
		const lockNode = findNode(lockXml, 'DomainGetRegistrarLockResult')
		return {
			id: info.attrs.ID,
			domain: info.attrs.DomainName || domain,
			owner: info.attrs.OwnerName,
			status: info.attrs.Status,
			isPremium: parseBool(info.attrs.IsPremium),
			created: childText(details, 'CreatedDate'),
			expires: childText(details, 'ExpiredDate'),
			isLocked: lockNode ? parseBool(lockNode.attrs.RegistrarLockStatus) : null,
			whoisGuard: {
				enabled: wg ? parseBool(wg.attrs.Enabled) : false,
				id: childText(wg, 'ID') || null,
				expires: childText(wg, 'ExpiredDate') || null
			},
			dns: {
				providerType: dns.attrs.ProviderType,
				usingOurDns: parseBool(dns.attrs.IsUsingOurDNS),
				hostCount: Number(dns.attrs.HostCount || 0),
				emailType: dns.attrs.EmailType,
				nameservers: findNodes(dns, 'Nameserver').map(n => n.text)
			},
			contacts
		}
	}
	async function check (arg) {
		const rawDomains = Array.isArray(arg) ? arg : arg?.domains
		if (!Array.isArray(rawDomains) || rawDomains.length === 0) {
			throw new Error('domains (non-empty array) is required')
		}
		const splits = await Promise.all(rawDomains.map(d => splitDomain(d)))
		const tldByDomain = new Map(splits.map(s => [s.domain, s.tld]))
		const xml = await call('namecheap.domains.check', { DomainList: splits.map(s => s.domain).join(',') })
		const checkNodes = findNodes(xml, 'DomainCheckResult')
		const tlds = [...new Set(splits.map(s => s.tld))]
		const pricingByTld = {}
		await Promise.all(tlds.map(async tld => {
			const pXml = await call('namecheap.users.getPricing', {
				ProductType: 'DOMAIN',
				ProductCategory: 'DOMAINS',
				ActionName: 'REGISTER',
				ProductName: tld
			})
			const prices = findNodes(pXml, 'Price').map(p => ({
				years: Number(p.attrs.Duration),
				price: Number(p.attrs.YourPrice || p.attrs.Price),
				regularPrice: Number(p.attrs.RegularPrice),
				icannFee: Number(p.attrs.YourAdditonalCost || p.attrs.AdditionalCost || 0),
				currency: p.attrs.Currency || 'USD'
			}))
			if (prices.length > 0) {
				pricingByTld[tld] = prices[0]
			}
		}))
		return {
			results: checkNodes.map(n => {
				const domain = n.attrs.Domain.toLowerCase()
				const tld = tldByDomain.get(domain) || domain.slice(domain.indexOf('.') + 1)
				const isPremium = parseBool(n.attrs.IsPremiumName)
				const stdPrice = pricingByTld[tld]
				return {
					domain: n.attrs.Domain,
					available: parseBool(n.attrs.Available),
					isPremium,
					price: isPremium
						? Number(n.attrs.PremiumRegistrationPrice)
						: (stdPrice ? stdPrice.price : null),
					renewalPrice: isPremium
						? Number(n.attrs.PremiumRenewalPrice)
						: (stdPrice ? stdPrice.regularPrice : null),
					icannFee: isPremium
						? Number(n.attrs.IcannFee || 0)
						: (stdPrice ? stdPrice.icannFee : 0),
					currency: stdPrice ? stdPrice.currency : 'USD'
				}
			})
		}
	}
	async function setNameservers ({ domain: rawDomain, nameservers } = {}) {
		if (!rawDomain) throw new Error('domain is required')
		if (nameservers === undefined || nameservers === null || nameservers === '' || (Array.isArray(nameservers) && nameservers.length === 0)) {
			throw new Error('nameservers is required ("default" or an array of at least 2 hostnames)')
		}
		const { domain, sld, tld } = await splitDomain(rawDomain)
		if (nameservers === 'default') {
			const xml = await call('namecheap.domains.dns.setDefault', { SLD: sld, TLD: tld }, 'POST')
			const resNode = findNode(xml, 'DomainDNSSetDefaultResult')
			return {
				domain,
				updated: parseBool(resNode.attrs.Updated),
				provider: 'default'
			}
		}
		const list = Array.isArray(nameservers) ? nameservers : String(nameservers).split(',').map(s => s.trim()).filter(Boolean)
		if (list.length < 2) {
			throw new Error('At least 2 custom nameservers are required')
		}
		const xml = await call('namecheap.domains.dns.setCustom', {
			SLD: sld,
			TLD: tld,
			Nameservers: list.join(',')
		}, 'POST')
		const resNode = findNode(xml, 'DomainDNSSetCustomResult')
		return {
			domain,
			updated: parseBool(resNode.attrs.Updated),
			provider: 'custom',
			nameservers: list
		}
	}
	async function setContacts ({ domain: rawDomain, contacts } = {}) {
		if (!rawDomain) throw new Error('domain is required')
		if (!contacts || typeof contacts !== 'object') {
			throw new Error('contacts object is required')
		}
		const { domain } = await splitDomain(rawDomain)
		const hasAllRoles = Boolean(contacts.registrant && contacts.tech && contacts.admin && contacts.billing)
		const existingContacts = hasAllRoles ? null : await getDomainContacts(call, domain)
		const contactParams = buildContactParams(contacts, existingContacts)
		const xml = await call('namecheap.domains.setContacts', {
			DomainName: domain,
			...contactParams
		}, 'POST')
		const resNode = findNode(xml, 'DomainSetContactResult')
		return {
			domain,
			updated: parseBool(resNode.attrs.IsSuccess)
		}
	}
	async function setLock ({ domain: rawDomain, locked } = {}) {
		if (!rawDomain) throw new Error('domain is required')
		if (typeof locked !== 'boolean') {
			throw new Error('locked (boolean) is required')
		}
		const { domain } = await splitDomain(rawDomain)
		const xml = await call('namecheap.domains.setRegistrarLock', {
			DomainName: domain,
			LockAction: locked ? 'LOCK' : 'UNLOCK'
		}, 'POST')
		const resNode = findNode(xml, 'DomainSetRegistrarLockResult')
		return {
			domain,
			locked,
			updated: parseBool(resNode.attrs.IsSuccess)
		}
	}
	async function register ({ domain: rawDomain, years = 1, whoisGuard = true, contacts, promoCode } = {}) {
		if (!rawDomain) throw new Error('domain is required')
		const { domain } = await splitDomain(rawDomain)
		const hasFallback = Boolean(contacts?.registrant)
		const defaultContact = hasFallback ? null : await getPrimaryAddress(call)
		const contactParams = buildContactParams(contacts || {}, defaultContact)
		const xml = await call('namecheap.domains.create', {
			DomainName: domain,
			Years: years,
			AddFreeWhoisguard: whoisGuard ? 'yes' : 'no',
			WGEnabled: whoisGuard ? 'yes' : 'no',
			PromotionCode: promoCode,
			...contactParams
		}, 'POST')
		const resNode = findNode(xml, 'DomainCreateResult')
		return {
			domain: resNode.attrs.Domain || domain,
			registered: parseBool(resNode.attrs.Registered),
			chargedAmount: Number(resNode.attrs.ChargedAmount || 0),
			domainId: resNode.attrs.DomainID,
			orderId: resNode.attrs.OrderID,
			transactionId: resNode.attrs.TransactionID,
			whoisGuardEnabled: parseBool(resNode.attrs.WhoisguardEnable)
		}
	}
	async function renew ({ domain: rawDomain, years = 1, promoCode } = {}) {
		if (!rawDomain) throw new Error('domain is required')
		const { domain } = await splitDomain(rawDomain)
		const xml = await call('namecheap.domains.renew', {
			DomainName: domain,
			Years: years,
			PromotionCode: promoCode
		}, 'POST')
		const resNode = findNode(xml, 'DomainRenewResult')
		const details = findNode(resNode, 'DomainDetails')
		return {
			domain: resNode.attrs.DomainName || domain,
			renewed: parseBool(resNode.attrs.Renew),
			chargedAmount: Number(resNode.attrs.ChargedAmount || 0),
			domainId: resNode.attrs.DomainID,
			orderId: resNode.attrs.OrderID,
			transactionId: resNode.attrs.TransactionID,
			expires: childText(details, 'ExpiredDate')
		}
	}
	async function balances () {
		const xml = await call('namecheap.users.getBalances')
		const resNode = findNode(xml, 'UserGetBalancesResult')
		return {
			currency: resNode.attrs.Currency || 'USD',
			availableBalance: Number(resNode.attrs.AvailableBalance || 0),
			accountBalance: Number(resNode.attrs.AccountBalance || 0),
			earnedAmount: Number(resNode.attrs.EarnedAmount || 0),
			withdrawableAmount: Number(resNode.attrs.WithdrawableAmount || 0),
			fundsRequiredForAutoRenew: Number(resNode.attrs.FundsRequiredForAutoRenew || 0)
		}
	}
	async function getDns (arg) {
		const rawDomain = typeof arg === 'object' && arg !== null ? arg.domain : arg
		if (!rawDomain) throw new Error('domain is required')
		const { domain, sld, tld } = await splitDomain(rawDomain)
		const xml = await call('namecheap.domains.dns.getHosts', { SLD: sld, TLD: tld })
		const resNode = findNode(xml, 'DomainDNSGetHostsResult')
		const emailType = resNode.attrs.EmailType || 'NONE'
		const usingOurDns = parseBool(resNode.attrs.IsUsingOurDNS)
		const records = findNodes(resNode, 'host').map(h => ({
			id: h.attrs.HostId,
			type: h.attrs.Type,
			name: h.attrs.Name,
			value: h.attrs.Address,
			prio: Number(h.attrs.MXPref ?? 10),
			ttl: Number(h.attrs.TTL ?? 1800),
			isActive: parseBool(h.attrs.IsActive),
			isDdnsEnabled: parseBool(h.attrs.IsDDNSEnabled)
		}))
		let emailForwarding = []
		if (emailType === 'FWD') {
			const fwdXml = await call('namecheap.domains.dns.getEmailForwarding', { DomainName: domain })
			emailForwarding = findNodes(fwdXml, 'Forward').map(f => ({
				mailbox: f.attrs.mailbox,
				forwardTo: f.text
			}))
		}
		return {
			domain,
			sld,
			tld,
			usingOurDns,
			emailType,
			records,
			...(emailForwarding.length > 0 ? { emailForwarding } : {})
		}
	}
	async function setDns ({ domain: rawDomain, records: inputRecords, mode = 'merge', upsert = true, emailType } = {}) {
		if (!rawDomain) throw new Error('domain is required')
		if (!Array.isArray(inputRecords) || inputRecords.length === 0) {
			throw new Error('records must be a non-empty array')
		}
		const normalizedInputs = inputRecords.map(normalizeRecordInput)
		for (const rec of normalizedInputs) {
			if (!rec.type || !rec.value) {
				throw new Error(`Each DNS record requires type and value; got: ${JSON.stringify(rec)}`)
			}
		}
		const current = await getDns(rawDomain)
		if (!current.usingOurDns) {
			throw new Error(`Domain ${current.domain} is not using Namecheap BasicDNS/PremiumDNS`)
		}
		let nextRecords
		if (mode === 'replace') {
			nextRecords = normalizedInputs.map(rec => ({
				...rec,
				prio: rec.prio ?? 10,
				ttl: rec.ttl ?? 300
			}))
		} else {
			nextRecords = current.records.map(r => ({ ...r }))
			for (const incoming of normalizedInputs) {
				if (incoming.id !== undefined) {
					const idxById = nextRecords.findIndex(r => String(r.id) === String(incoming.id))
					if (idxById === -1) {
						throw new Error(`DNS record with id "${incoming.id}" not found in ${current.domain}`)
					}
					nextRecords[idxById] = { ...nextRecords[idxById], ...incoming }
					continue
				}
				const exactIdx = nextRecords.findIndex(r => recordsMatchExact(r, incoming))
				if (exactIdx !== -1) {
					nextRecords[exactIdx] = { ...nextRecords[exactIdx], ...incoming }
					continue
				}
				if (upsert && SINGLE_VALUE_TYPES.has(incoming.type)) {
					const sameHostTypeIndices = nextRecords
						.map((r, idx) => (r.type.toUpperCase() === incoming.type && r.name.toLowerCase() === incoming.name.toLowerCase()) ? idx : -1)
						.filter(idx => idx !== -1)
					if (sameHostTypeIndices.length === 1) {
						nextRecords[sameHostTypeIndices[0]] = { ...nextRecords[sameHostTypeIndices[0]], ...incoming }
						continue
					}
				}
				nextRecords.push({
					...incoming,
					prio: incoming.prio ?? 10,
					ttl: incoming.ttl ?? 300
				})
			}
		}
		const effectiveEmailType = resolveEmailType(nextRecords, current.emailType, emailType)
		await writeHosts(call, {
			sld: current.sld,
			tld: current.tld,
			emailType: effectiveEmailType,
			records: nextRecords
		})
		const updated = await getDns(current.domain)
		return {
			domain: updated.domain,
			emailType: updated.emailType,
			records: updated.records
		}
	}
	async function deleteDns ({ domain: rawDomain, records: targets } = {}) {
		if (!rawDomain) throw new Error('domain is required')
		if (!Array.isArray(targets) || targets.length === 0) {
			throw new Error('records must be a non-empty array of record matchers to delete')
		}
		const current = await getDns(rawDomain)
		if (!current.usingOurDns) {
			throw new Error(`Domain ${current.domain} is not using Namecheap BasicDNS/PremiumDNS`)
		}
		const deleted = []
		const notFound = []
		let remaining = current.records.map(r => ({ ...r }))
		for (const target of targets) {
			const matchIndices = []
			remaining.forEach((rec, idx) => {
				if (target.id && String(rec.id) === String(target.id)) {
					matchIndices.push(idx)
					return
				}
				if (target.type && rec.type.toUpperCase() !== String(target.type).toUpperCase()) return
				if (target.name && rec.name.toLowerCase() !== String(target.name).toLowerCase()) return
				if (target.value !== undefined && normalizeValueForCompare(rec.type.toUpperCase(), rec.value) !== normalizeValueForCompare(rec.type.toUpperCase(), target.value)) {
					return
				}
				if (target.prio !== undefined && Number(rec.prio) !== Number(target.prio)) return
				if (!target.id && !target.type && !target.name && target.value === undefined) return
				matchIndices.push(idx)
			})
			if (matchIndices.length === 0) {
				notFound.push(target)
			} else {
				const toRemove = new Set(matchIndices)
				for (const idx of matchIndices) {
					deleted.push(remaining[idx])
				}
				remaining = remaining.filter((_, idx) => !toRemove.has(idx))
			}
		}
		if (deleted.length > 0) {
			const effectiveEmailType = resolveEmailType(remaining, current.emailType)
			await writeHosts(call, {
				sld: current.sld,
				tld: current.tld,
				emailType: effectiveEmailType,
				records: remaining
			})
		}
		const updated = deleted.length > 0 ? await getDns(current.domain) : current
		return {
			domain: updated.domain,
			deletedCount: deleted.length,
			deleted,
			notFound,
			emailType: updated.emailType,
			records: updated.records
		}
	}
	async function setEmailForwarding ({ domain: rawDomain, forwards } = {}) {
		if (!rawDomain) throw new Error('domain is required')
		if (!Array.isArray(forwards) || forwards.length === 0) {
			throw new Error('forwards must be a non-empty array')
		}
		const current = await getDns(rawDomain)
		if (!current.usingOurDns) {
			throw new Error(`Domain ${current.domain} is not using Namecheap BasicDNS/PremiumDNS`)
		}
		if (current.emailType !== 'FWD') {
			await writeHosts(call, {
				sld: current.sld,
				tld: current.tld,
				emailType: 'FWD',
				records: current.records
			})
		}
		const params = { DomainName: current.domain }
		forwards.forEach((f, i) => {
			const idx = i + 1
			params[`MailBox${idx}`] = f.mailbox
			params[`ForwardTo${idx}`] = f.forwardTo
		})
		const xml = await call('namecheap.domains.dns.setEmailForwarding', params, 'POST')
		const resNode = findNode(xml, 'DomainDNSSetEmailForwardingResult')
		return {
			domain: current.domain,
			updated: parseBool(resNode.attrs.IsSuccess),
			forwards
		}
	}
	return {
		call,
		splitDomain,
		domains: {
			list,
			get,
			check,
			set_nameservers: setNameservers,
			set_contacts: setContacts,
			set_lock: setLock,
			register,
			renew,
			balances
		},
		dns: {
			get: getDns,
			set: setDns,
			delete: deleteDns,
			set_email_forwarding: setEmailForwarding
		}
	}
}
