#!/usr/bin/env node
import dotenv from 'dotenv'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createMcpHandler } from './mcp.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(dirname, '.env'), quiet: true })

const { createRpcEngine } = createMcpHandler()
const rpc = createRpcEngine(data => {
	if (data) {
		process.stdout.write(`${data}\n`)
	}
})
const rl = readline.createInterface({
	input: process.stdin,
	terminal: false
})
rl.on('line', line => {
	const trimmed = line.trim()
	if (!trimmed) return
	rpc.receive(trimmed)
})
