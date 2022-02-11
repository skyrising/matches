import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import {spawn, getEra, getVersionDetails} from './utils.mjs'

const versionDataDir = path.resolve('mc-versions', 'data')
const versionDir = path.resolve(versionDataDir, 'version')

const STITCH = {maven: 'https://maven.fabricmc.net/', group: 'net.fabricmc', artifact: 'stitch', version: '0.6.1', classifier: 'all'}
const MATCHES_DIR = 'matches'

;(async () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(versionDataDir, 'version_manifest.json')))
    if (process.argv.length > 3) {
        await setupMatchEnv(manifest, process.argv[2], process.argv[3])
    } else {
        const arg = process.argv[2]
        if (arg === 'refresh') {
            await refresh(manifest)
            return
        }
        const next = arg === 'next'
        const first = manifest.versions[manifest.versions.length - 1].omniId
        await setupWalkGraph(manifest, first, next)
    }
})()

async function setupWalkGraph(manifest, version, next) {
    const data = JSON.parse(fs.readFileSync(path.resolve(versionDir, `${version}.json`)))
    let anyChanged = false
    for (const nextVersion of data.next) {
        const changed = await setupMatchEnv(manifest, version, nextVersion) || await setupWalkGraph(manifest, nextVersion, next)
        if (changed && next) {
            return true
        }
        anyChanged = anyChanged || changed
    }
    return anyChanged
}

async function setupMatchEnv(manifest, versionA, versionB) {
    const eraB = getEra(versionB)
    const matchDir = eraB ? path.resolve(MATCHES_DIR, eraB) : path.resolve(MATCHES_DIR)
    const matchFile = path.resolve(matchDir, `${versionA}#${versionB}.match`)
    if (!fs.existsSync(matchFile)) {
        const infoA = await getVersionInfo(manifest, versionA)
        const mainJarA = await getMainJar(infoA, versionA)
        const librariesA = new Set(await getLibraries(infoA))
        const infoB = await getVersionInfo(manifest, versionB)
        const mainJarB = await getMainJar(infoB, versionB)
        const librariesB = new Set(await getLibraries(infoB))
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
            const info = ({a: infoA, b: infoB})[side]
            if (info.releaseTime > '2013-04-18' && !info.id.startsWith('1.5')) continue
            lines.push(`\tnon-obf ${type} ${side}\tpaulscode|jcraft`)
        }
        lines.push('c\tLdummy;\tLdummy;', '')
        mkdirp(path.dirname(matchFile))
        fs.writeFileSync(matchFile, lines.join('\n'))
        return true
    }
    return false
}

async function refresh(manifest) {
    const versions = new Set()
    for (const era of fs.readdirSync(MATCHES_DIR)) {
        const eraDir = path.resolve(MATCHES_DIR, era)
        if (!fs.statSync(eraDir).isDirectory()) {
            if (!eraDir.endsWith('.match')) continue
            const [versionA, versionB] = path.basename(eraDir, '.match').split('#')
            versions.add(versionA)
            versions.add(versionB)
            continue
        }
        for (const name of fs.readdirSync(eraDir)) {
            const matchFile = path.resolve(eraDir, name)
            if (!matchFile.endsWith('.match')) continue
            const [versionA, versionB] = path.basename(matchFile, '.match').split('#')
            versions.add(versionA)
            versions.add(versionB)
        }
    }
    for (const version of versions) {
        const info = await getVersionInfo(manifest, version)
        const mainJar = await getMainJar(info, version)
        await getLibraries(info)
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

async function getMainJar(version, id) {
    const dir = path.resolve('versions', id)
    const files = {}
    for (const key in version.downloads) {
        const download = version.downloads[key]
        if (!download.url.endsWith('.jar')) continue
        if (key !== 'client' && key !== 'server') {
            throw Error(`Unexpected jar download '${key}'`)
        }
        const file = path.resolve(dir, key + '.jar')
        files[key] = file
        await downloadFile(download.url, file)
    }
    if (!files.client && !files.server) throw Error('Expected at least one jar')
    let name = 'minecraft'
    if (files.server && !files.client) name = 'minecraft-server'
    const dest = path.resolve(`libraries/com/mojang/${name}/${id}/${name}-${id}.jar`)
    if (fs.existsSync(dest)) return dest
    mkdirp(path.dirname(dest))
    if (files.client && files.server && getVersionDetails(id).sharedMappings) {
        await mergeJars(files.client, files.server, dest)
        // TODO: map both client and server separately for non-shared mappings
    } else if (files.client) {
        fs.linkSync(files.client, dest)
    } else {
        fs.linkSync(files.server, dest)
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