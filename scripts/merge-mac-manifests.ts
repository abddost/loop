#!/usr/bin/env bun
/**
 * Merge per-arch latest-mac.yml files into one combined manifest.
 *
 * electron-builder writes a separate `latest-mac.yml` for each arch
 * matrix job. When both Mac artifacts are downloaded into the same
 * directory, the second one overwrites the first — leaving a manifest
 * that only references one arch. electron-updater then offers the
 * wrong build to half the audience (an arm64 user gets the x64 .dmg
 * and silently runs under Rosetta).
 *
 * The fix is to keep a single `latest-mac.yml` whose `files` array
 * lists *all* arch artifacts. electron-updater 6.x picks the right one
 * by matching the URL suffix to `process.arch`.
 *
 * Usage:
 *   bun scripts/merge-mac-manifests.ts \
 *     <arm64-manifest> <x64-manifest> > <output>
 */

import { readFileSync } from "node:fs"
// js-yaml is a transitive dep of electron-updater — guaranteed in node_modules.
import yaml from "js-yaml"

interface ManifestFile {
	url: string
	sha512: string
	size: number
}

interface MacManifest {
	version: string
	files: ManifestFile[]
	path: string
	sha512: string
	releaseDate: string
}

const [armPath, x64Path] = process.argv.slice(2)
if (!armPath || !x64Path) {
	console.error("usage: merge-mac-manifests.ts <arm64-manifest> <x64-manifest>")
	process.exit(1)
}

const arm = yaml.load(readFileSync(armPath, "utf-8")) as MacManifest
const x64 = yaml.load(readFileSync(x64Path, "utf-8")) as MacManifest

if (arm.version !== x64.version) {
	console.error(
		`version mismatch: arm64=${arm.version} x64=${x64.version}; refusing to merge`,
	)
	process.exit(1)
}

// Combine the file lists, deduping by URL just in case CI ran a job twice.
const seen = new Set<string>()
const files: ManifestFile[] = []
for (const f of [...arm.files, ...x64.files]) {
	if (seen.has(f.url)) continue
	seen.add(f.url)
	files.push(f)
}

// Pick the arm64 entry as the "primary" path/sha512 — modern Macs are the
// majority and electron-updater uses these only as a fallback when the
// arch-specific entry isn't found in `files`.
const merged: MacManifest = {
	version: arm.version,
	files,
	path: arm.path,
	sha512: arm.sha512,
	// Take whichever release was built later.
	releaseDate:
		new Date(arm.releaseDate) > new Date(x64.releaseDate)
			? arm.releaseDate
			: x64.releaseDate,
}

process.stdout.write(yaml.dump(merged, { lineWidth: -1 }))
