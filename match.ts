#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write --allow-run

import './mc-versions/types.d.ts'
import * as path from 'https://deno.land/std@0.159.0/path/mod.ts'
import {spawn, getEra, getVersionDetails, exists} from './utils.ts'

type VersionManifest = BaseVersionManifest & {
    libraries: {
        downloads?: {
            artifact: {
                url: string
                path: string
            }
        }
    }[]
}

const versionDataDir = path.resolve('mc-versions', 'data')

interface Tool {
    maven: string
    group: string
    artifact: string
    version: string
    classifier?: string
}

const STITCH: Tool = {maven: 'https://maven.fabricmc.net/', group: 'net.fabricmc', artifact: 'stitch', version: '0.6.1', classifier: 'all'}
const MATCHES_DIR = 'matches'
const COMMIT_MSG_FILE = '.git/COMMIT_MSG'

const ANY_MATCH_TYPES = [
    ['merged', 'merged'],
    ['client', 'merged'],
    ['client', 'client'],
    ['server', 'merged'],
    ['server', 'server']
]

type Command = (manifest: MainManifest, args: string[]) => Promise<void>

const COMMANDS: Record<string, Command> = {
    async next(manifest: MainManifest, args: string[]) {
        await setupNext(manifest, args[0])
    },
    async refresh(manifest: MainManifest) {
        await refresh(manifest)
    },
    async commit(_manifest: MainManifest, args: string[]) {
        await generateCommitMessage(args)
    }
}

const manifest: MainManifest = JSON.parse(await Deno.readTextFile(path.resolve(versionDataDir, 'version_manifest.json')))
const cmd = COMMANDS[Deno.args[0]]
if (!cmd && Deno.args.length > 1) {
    if (Deno.args.length > 3) {
        // <typeA> <versionA> <typeB> <versionB>
        await setupMatchEnv(manifest, Deno.args[1], Deno.args[0], Deno.args[3], Deno.args[2])
    } else {
        // <versionA> <versionB>
        await setupAnyMatchEnv(manifest, Deno.args[0], Deno.args[1])
    }
} else {
    await cmd(manifest, Deno.args.slice(1))
}

async function setupNext(manifest: MainManifest, era?: string) {
    const handled = new Set()
    const queue = new Set(['rd-132211-launcher', 'server-c1.2'])
    while (queue.size) {
        const current = queue.values().next().value
        queue.delete(current)
        if (handled.has(current)) continue
        handled.add(current)
        const details = await getVersionDetails(current)
        for (const next of details.next || []) {
            try {
                if (await setupAnyMatchEnv(manifest, current, next, era)) return true
            } catch (e) {
                // Ignore errors for classic servers for now
                // TODO: handle `server_zip`
                console.error(e)
            }
            queue.add(next)
        }
    }
    return false
}

async function setupAnyMatchEnv(manifest: MainManifest, versionA: string, versionB: string, era?: string) {
    for (const [typeA, typeB] of ANY_MATCH_TYPES) {
        const [canCreate, didCreate] = await setupMatchEnv(manifest, versionA, typeA, versionB, typeB, era)
        if (didCreate) return true
        if (canCreate) break
    }
    return false
}

async function setupMatchEnv(manifest: MainManifest, versionA: string, typeA: string, versionB: string, typeB: string, era?: string) {
    const type = typeA === typeB ? typeA : 'cross'
    const prefixA = type === 'cross' ? typeA + '-' : ''
    const prefixB = type === 'cross' ? typeB + '-' : ''
    const typeDir = path.resolve(MATCHES_DIR, type)
    const eraB = await getEra(versionB)
    if (era && era !== eraB) return [true, false]
    const matchDir = eraB ? path.resolve(typeDir, eraB) : typeDir
    const matchFile = path.resolve(matchDir, `${prefixA}${versionA}#${prefixB}${versionB}.match`)
    if (!(await exists(matchFile))) {
        const mainJarA = await getMainJar(versionA, typeA)
        const mainJarB = await getMainJar(versionB, typeB)
        const infoA = await getVersionInfo(manifest, versionA)
        const infoB = await getVersionInfo(manifest, versionB)
        if (!mainJarA || !mainJarB || !infoA || !infoB) return [false, false]
        const librariesA: Set<string> = typeA === 'server' ? new Set() : new Set(await getLibraries(infoA))
        const librariesB: Set<string> = typeB === 'server' ? new Set() : new Set(await getLibraries(infoB))
        const [shared, libsA, libsB] = computeShared(librariesA, librariesB)
        console.log(mainJarA, libsA)
        console.log(mainJarB, libsB)
        console.log(shared)
        const lines = ['Matches saved auto-generated']
        lines.push('\ta:', `\t\t${path.basename(mainJarA)}`)
        lines.push('\tb:', `\t\t${path.basename(mainJarB)}`)
        lines.push('\tcp:')
        for (const cp of shared) lines.push(`\t\t${path.basename(cp)}`)
        lines.push('\tcp a:')
        for (const cp of libsA) lines.push(`\t\t${path.basename(cp)}`)
        lines.push('\tcp b:')
        for (const cp of libsB) lines.push(`\t\t${path.basename(cp)}`)
        for (const type of ['cls', 'mem']) for (const side of ['a', 'b']) {
            const info = await getVersionDetails(({a: versionA, b: versionB})[side]!)
            if (info.releaseTime > '2013-04-18' && !info.id.startsWith('1.5')) continue
            lines.push(`\tnon-obf ${type} ${side}\tpaulscode|jcraft`)
        }
        lines.push('c\tLdummy;\tLdummy;', '')
        await Deno.mkdir(path.dirname(matchFile), {recursive: true})
        await Deno.writeTextFile(matchFile, lines.join('\n'))
        await Deno.writeTextFile('current.txt', `Current Match: ${versionA} \u2192 ${versionB}`)
        return [true, true]
    }
    return [true, false]
}

async function sortedReadDir(path: string) {
    const entries = []
    for await (const entry of Deno.readDir(path)) {
        entries.push(entry.name)
    }
    return entries.sort()
}

async function refresh(manifest: MainManifest) {
    const versions: Set<string> = new Set()
    for (const matchType of await sortedReadDir(MATCHES_DIR)) {
        const matchTypeDir = path.resolve(MATCHES_DIR, matchType)
        const prefix = matchType === 'cross' ? '' : matchType + '-'
        for (const era of await sortedReadDir(matchTypeDir)) {
            const eraDir = path.resolve(matchTypeDir, era)
            if (!(await Deno.stat(eraDir)).isDirectory) {
                if (!eraDir.endsWith('.match')) continue
                const [versionA, versionB] = path.basename(eraDir, '.match').split('#')
                versions.add(prefix + versionA)
                versions.add(prefix + versionB)
                continue
            }
            for await (const entry of Deno.readDir(eraDir)) {
                const matchFile = path.resolve(eraDir, entry.name)
                if (!matchFile.endsWith('.match')) continue
                const [versionA, versionB] = path.basename(matchFile, '.match').split('#')
                versions.add(prefix + versionA)
                versions.add(prefix + versionB)
            }
        }
    }
    for (let version of versions) {
        const type = version.slice(0, version.indexOf('-'))
        version = version.slice(type.length + 1)
        console.log(version, type)
        const info = await getVersionInfo(manifest, version)
        if (!info) continue
        await getMainJar(version, type)
        if (type !== 'server') {
            await getLibraries(info)
        }
    } 
}

async function getVersionInfo(manifest: MainManifest, id: string) {
    const info = manifest.versions.find(v => v.omniId === id)
    if (!info) {
        console.error(`${id} not found`)
        return
    }
    return JSON.parse(await Deno.readTextFile(path.resolve(versionDataDir, info.url))) as VersionManifest
}

async function getMainJar(id: string, type: string) {
    const details = await getVersionDetails(id)
    const dir = path.resolve('versions', id)
    const files: Record<string, string> = {}
    for (const key in details.downloads) {
        const download = details.downloads[key]
        if (!download.url.endsWith('.jar')) continue
        if (key !== 'client' && key !== 'server') {
            throw Error(`Unexpected jar download '${key}'`)
        }
        const file = path.resolve(dir, key + '.jar')
        files[key] = file
        await downloadFile(download.url, file)
    }
    if (!files.client && !files.server) throw Error('Expected at least one jar for ' + id)
    const name = 'minecraft-' + type
    const dest = path.resolve(`libraries/com/mojang/${name}/${id}/${name}-${id}.jar`)
    if (await exists(dest)) return dest
    if (type === 'merged') {
        if (!files.client || !files.client || !details.sharedMappings) return null
        await Deno.mkdir(path.dirname(dest), {recursive: true})
        await mergeJars(files.client, files.server, dest)
    } else {
        if (!files[type]) return null
        await Deno.mkdir(path.dirname(dest), {recursive: true})
        await Deno.link(files[type], dest)
    }
    return dest
}

async function downloadFile(url: URL|string, file: string) {
    if (await exists(file)) return
    console.log(`Downloading ${url}`)
    await Deno.mkdir(path.dirname(file), {recursive: true})
    const res = await fetch(url)
    const fd = await Deno.open(file, {write: true, createNew: true})
    await res.body?.pipeTo(fd.writable)
}

async function getLibraries(version: VersionManifest) {
    const files = []
    for (const lib of Object.values(version.libraries)) {
        if (!lib.downloads) continue
        const artifact = lib.downloads.artifact
        if (!artifact) continue
        const p = path.resolve('libraries', artifact.path)
        files.push(p)
        await downloadFile(artifact.url, p)
    }
    return files
}

function computeShared<T>(a: Set<T>, b: Set<T>): [T[], T[], T[]] {
    const combined = new Set([...a, ...b])
    const resultA = []
    const resultB = []
    const shared = []
    for (const e of combined) {
        if (a.has(e) && b.has(e)) shared.push(e)
        else if (a.has(e)) resultA.push(e)
        else resultB.push(e)
    }
    return [shared, resultA, resultB]
}

async function getTool(tool: Tool) {
    const toolPath = `${tool.group.replace('.', '/')}/${tool.artifact}/${tool.version}/${tool.artifact}-${tool.version}${tool.classifier ? '-' + tool.classifier : ''}.jar`
    const url = new URL(toolPath, tool.maven)
    const file = path.resolve('libraries', toolPath)
    await downloadFile(url, file)
    return file
}

function java(args: string[], opts: Omit<Deno.RunOptions, 'cmd'> = {}) {
    const JAVA_HOME = Deno.env.get('JAVA_HOME')
    const java = JAVA_HOME ? path.resolve(JAVA_HOME, 'bin/java') : 'java'
    return spawn(java, args, opts)
}

async function stitch(...args: string[]) {
    return java(['-jar', await getTool(STITCH), ...args])
}

function mergeJars(client: string, server: string, merged: string) {
    return stitch('mergeJar', client, server, merged, '--removeSnowman', '--syntheticparams')
}

async function generateCommitMessage(args: string[]) {
    const gitStatus = Deno.run({cmd: ['git', 'status', '--porcelain=v2'], stdout: 'piped'})
    const {code} = await gitStatus.status()
    if (code) return
    const statusText = new TextDecoder().decode(await gitStatus.output())
    const status = statusText.split('\n').filter(Boolean).map(line => {
        const parts = line.split(' ')
        if (parts[0] !== '1') return undefined
        const [_type, xy, _sub, _modeHead, _modeIndex, _modeWorktree, _nameHead, _nameIndex, path] = parts
        return {path, status: xy}
    }).filter(Boolean) as {path: string, status: string}[]
    const addedMatches = status.filter(file => file.path.startsWith('matches/') && file.status[0] === 'A').map(file => {
        const parts = file.path.split('/')
        let [versionA, versionB] = parts[3].slice(0, -6).split('#')
        let [typeA, typeB] = [parts[1], parts[1]]
        if (parts[1] === 'cross') {
            const [ta, va] = versionA.split('-')
            versionA = va
            typeA = ta
            const [tb, vb] = versionB.split('-')
            versionB = vb
            typeB = tb
        }
        const suffixA = typeA === typeB || versionA.includes(typeA) ? '' : ' (' + typeA + ')'
        const suffixB = typeA === typeB || versionB.includes(typeB) ? '' : ' (' + typeB + ')'
        const suffix = typeA === typeB && typeA !== 'merged' && !(versionA.includes(typeA) && versionB.includes(typeB))  ? ' (' + typeA + ')' : ''
        return `${versionA}${suffixA} -> ${versionB}${suffixB}${suffix}`
    })
    if (!addedMatches.length) {
        console.error('No matches added')
        return
    }
    let message = addedMatches.join(', ')
    const coAuthors = args.map(name => name.endsWith('>') ? name : `${name} <${name}@users.noreply.github.com>`)
    if (coAuthors.length) {
        message += '\n\n' + coAuthors.map(author => `Co-Authored-By: ${author}`).join('\n')
    }
    await Deno.writeTextFile(COMMIT_MSG_FILE, message)
    await Deno.run({cmd: ['git', 'commit', '-F', COMMIT_MSG_FILE]}).status()
}