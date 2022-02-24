import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import {spawn, getEra, getVersionDetails} from './utils.mjs'

const versionDataDir = path.resolve('mc-versions', 'data')
const versionDir = path.resolve(versionDataDir, 'version')

const STITCH = {maven: 'https://maven.fabricmc.net/', group: 'net.fabricmc', artifact: 'stitch', version: '0.6.1', classifier: 'all'}
const MATCHES_DIR = 'matches'

const ANY_MATCH_TYPES = [
    ['merged', 'merged'],
    ['client', 'merged'],
    ['client', 'client'],
    ['server', 'merged'],
    ['server', 'server']
]

;(async () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(versionDataDir, 'version_manifest.json')))
    if (process.argv.length > 3) {
        if (process.argv.length > 5) {
            // setup <typeA> <versionA> <typeB> <versionB>
            await setupMatchEnv(manifest, process.argv[3], process.argv[2], process.argv[5], process.argv[4])
        } else {
            // setup <versionA> <versionB>
            await setupAnyMatchEnv(manifest, process.argv[2], process.argv[3])
        }
    } else {
        const arg = process.argv[2]
        if (arg === 'refresh') {
            // setup refresh
            await refresh(manifest)
            return
        } else if (arg === 'next') {
            await setupNext(manifest)
        }
    }
})()

async function setupNext(manifest) {
    const queue = new Set(['rd-132211-launcher', 'server-c1.2'])
    while (queue.size) {
        const current = queue.values().next().value
        queue.delete(current)
        const details = getVersionDetails(current)
        for (const next of details.next || []) {
            try {
                if (await setupAnyMatchEnv(manifest, current, next)) return true
            } catch (e) {
                // Ignore errors for classic servers for now
                // TODO: handle `server_zip`
            }
            queue.add(next)
        }
    }
    return false
}

async function setupAnyMatchEnv(manifest, versionA, versionB) {
    for (const [typeA, typeB] of ANY_MATCH_TYPES) {
        const [canCreate, didCreate] = await setupMatchEnv(manifest, versionA, typeA, versionB, typeB)
        if (didCreate) return true
        if (canCreate) break
    }
    return false
}

async function setupMatchEnv(manifest, versionA, typeA, versionB, typeB) {
    const type = typeA === typeB ? typeA : 'cross'
    const prefixA = type === 'cross' ? typeA + '-' : ''
    const prefixB = type === 'cross' ? typeB + '-' : ''
    const typeDir = path.resolve(MATCHES_DIR, type)
    const eraB = getEra(versionB)
    const matchDir = eraB ? path.resolve(typeDir, eraB) : typeDir
    const matchFile = path.resolve(matchDir, `${prefixA}${versionA}#${prefixB}${versionB}.match`)
    if (!fs.existsSync(matchFile)) {
        const mainJarA = await getMainJar(versionA, typeA)
        const mainJarB = await getMainJar(versionB, typeB)
        if (!mainJarA || !mainJarB) {
            return [false, false]
        }
        const librariesA = typeA === 'server' ? new Set() : new Set(await getLibraries(await getVersionInfo(manifest, versionA)))
        const librariesB = typeB === 'server' ? new Set() : new Set(await getLibraries(await getVersionInfo(manifest, versionB)))
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
            const info = ({a: getVersionDetails(versionA), b: getVersionDetails(versionB)})[side]
            if (info.releaseTime > '2013-04-18' && !info.id.startsWith('1.5')) continue
            lines.push(`\tnon-obf ${type} ${side}\tpaulscode|jcraft`)
        }
        lines.push('c\tLdummy;\tLdummy;', '')
        mkdirp(path.dirname(matchFile))
        fs.writeFileSync(matchFile, lines.join('\n'))
        fs.writeFileSync('current.txt', `Current Match: ${versionA} \u2192 ${versionB}`)
        return [true, true]
    }
    return [true, false]
}

async function refresh(manifest) {
    const versions = new Set()
    for (const matchType of fs.readdirSync(MATCHES_DIR)) {
        const matchTypeDir = path.resolve(MATCHES_DIR, matchType)
        const prefix = matchType === 'cross' ? '' : matchType + '-'
        for (const era of fs.readdirSync(matchTypeDir)) {
            const eraDir = path.resolve(matchTypeDir, era)
            if (!fs.statSync(eraDir).isDirectory()) {
                if (!eraDir.endsWith('.match')) continue
                const [versionA, versionB] = path.basename(eraDir, '.match').split('#')
                versions.add(prefix + versionA)
                versions.add(prefix + versionB)
                continue
            }
            for (const name of fs.readdirSync(eraDir)) {
                const matchFile = path.resolve(eraDir, name)
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
        const mainJar = await getMainJar(version, type)
        if (type !== 'server') {
            await getLibraries(info)
        }
        console.log(mainJar)
    } 
}

async function getVersionInfo(manifest, id) {
    const info = manifest.versions.find(v => v.omniId === id)
    if (!info) {
        console.error(`${id} not found`)
        return
    }
    return JSON.parse(fs.readFileSync(path.resolve(versionDataDir, info.url)))
}

async function getMainJar(id, type) {
    const details = getVersionDetails(id)
    const dir = path.resolve('versions', id)
    const files = {}
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
    if (fs.existsSync(dest)) return dest
    if (type === 'merged') {
        if (!files.client || !files.client || !details.sharedMappings) return null
        mkdirp(path.dirname(dest))
        await mergeJars(files.client, files.server, dest)
    } else {
        if (!files[type]) return null
        mkdirp(path.dirname(dest))
        fs.linkSync(files[type], dest)
    }
    return dest
}

async function downloadFile(url, file) {
    if (fs.existsSync(file)) return
    console.log(`Downloading ${url}`)
    mkdirp(path.dirname(file))
    await fetch(url).then(res => promisifiedPipe(res.body, fs.createWriteStream(file)))
}

function mkdirp(dir) {
    if (fs.existsSync(dir)) return
    mkdirp(path.dirname(dir))
    fs.mkdirSync(dir)
}

async function getLibraries(version) {
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

function computeShared(a, b) {
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

function promisifiedPipe(input, output) {
    let ended = false
    function end() {
        if (!ended) {
            ended = true
            output.close && output.close()
            input.close && input.close()
            return true
        }
    }

    return new Promise((resolve, reject) => {
        input.pipe(output)
        output.on('finish', () => {
            if (end()) resolve()
        })
        output.on('end', () => {
            if (end()) resolve()
        })
        input.on('error', err => {
            if (end()) reject(err)
        })
        output.on('error', err => {
            if (end()) reject(err)
        })
    })
}

async function getTool(tool) {
    const toolPath = `${tool.group.replace('.', '/')}/${tool.artifact}/${tool.version}/${tool.artifact}-${tool.version}${tool.classifier ? '-' + tool.classifier : ''}.jar`
    const url = new URL(toolPath, tool.maven)
    const file = path.resolve('libraries', toolPath)
    await downloadFile(url, file)
    return file
}

function java(args, opts) {
    const JAVA_HOME = process.env['JAVA_HOME']
    const java = JAVA_HOME ? path.resolve(JAVA_HOME, 'bin/java') : 'java'
    return spawn(java, args, opts)
}

async function stitch(...args) {
    return java(['-jar', await getTool(STITCH), ...args], {stdio: 'inherit'})
}

function mergeJars(client, server, merged) {
    return stitch('mergeJar', client, server, merged, '--removeSnowman', '--syntheticparams')
}