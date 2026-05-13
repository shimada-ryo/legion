#!/usr/bin/env bun
import { runCli } from '../src/index'

await runCli(process.argv.slice(2))
