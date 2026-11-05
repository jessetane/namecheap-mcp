const ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
}

export function decodeXml (str) {
	if (!str) return ''
	return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
		if (entity[0] === '#') {
			const code = entity[1].toLowerCase() === 'x'
				? parseInt(entity.slice(2), 16)
				: parseInt(entity.slice(1), 10)
			return Number.isNaN(code) ? match : String.fromCodePoint(code)
		}
		return ENTITIES[entity] ?? match
	})
}

export function parseAttrs (attrStr) {
	const attrs = {}
	if (!attrStr) return attrs
	const re = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
	let m
	while ((m = re.exec(attrStr)) !== null) {
		attrs[m[1]] = decodeXml(m[2] ?? m[3] ?? '')
	}
	return attrs
}

export function parseXml (xml) {
	const clean = String(xml)
		.replace(/<\?xml[\s\S]*?\?>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.trim()
	const root = { tag: '#root', attrs: {}, children: [], text: '' }
	const stack = [root]
	const tokenRe = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z0-9_:-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g
	let m
	while ((m = tokenRe.exec(clean)) !== null) {
		const [, cdata, closing, tag, attrStr, selfClosing, textNode] = m
		const parent = stack[stack.length - 1]
		if (cdata !== undefined) {
			const trimmed = cdata.trim()
			if (trimmed) {
				parent.text = parent.text ? `${parent.text} ${trimmed}` : trimmed
			}
			continue
		}
		if (textNode !== undefined) {
			const decoded = decodeXml(textNode).trim()
			if (decoded) {
				parent.text = parent.text ? `${parent.text} ${decoded}` : decoded
			}
			continue
		}
		if (closing) {
			if (stack.length > 1) stack.pop()
			continue
		}
		const node = {
			tag,
			attrs: parseAttrs(attrStr),
			children: [],
			text: ''
		}
		parent.children.push(node)
		if (!selfClosing) {
			stack.push(node)
		}
	}
	return root.children[0] || root
}

export function findNode (node, tag) {
	if (!node) return null
	const target = tag.toLowerCase()
	if (node.tag.toLowerCase() === target) return node
	for (const child of node.children) {
		const found = findNode(child, tag)
		if (found) return found
	}
	return null
}

export function findNodes (node, tag, out = []) {
	if (!node) return out
	const target = tag.toLowerCase()
	if (node.tag.toLowerCase() === target) out.push(node)
	for (const child of node.children) {
		findNodes(child, tag, out)
	}
	return out
}

export function childText (node, tag) {
	if (!node) return ''
	const target = tag.toLowerCase()
	const child = node.children.find(c => c.tag.toLowerCase() === target)
	return child ? child.text : ''
}
