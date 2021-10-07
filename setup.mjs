import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'

const versionDataDir = path.resolve('mc-versions', 'data')
const versionDir = path.resolve(versionDataDir, 'version')

;(async () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(versionDataDir, 'version_manifest.json')))
    if (process.argv.length > 3) {
        await setupMatchEnv(manifest, process.argv[2], process.argv[3])
    } else {
        const next = process.argv.length > 2 && process.argv[2] === 'next'
        const first = manifest.versions[manifest.versions.length - 1].omniId
        await setupWalkGraph(manifest, first, next)
    }
})()

async function setupWalkGraph(manifest, version, next) {
    const data = JSON.parse(fs.readFileSync(path.resolve(versionDir, `${version}.json`)))
    let anyChanged = false
    for (const nextVersion of data.next) {
        const changed = await setupMatchEnv(manifest, version, nextVersion) || await setupWalkGraph(manifest, nextVersion)
        if (changed && next) {
            return true
        }
        anyChanged = anyChanged || changed
    }
    return anyChanged
}

const ERAS = {
    inf: 'infdev',
    in: 'indev',
    a: 'alpha',
    b: 'beta',
    c: 'classic',
    rd: 'pre-classic'
}

function getEra(version) {
    for (const key in ERAS) {
        if (version.startsWith(key)) return ERAS[key]
    }
    const releaseTarget = getVersionDetails(version).releaseTarget
    console.log(releaseTarget)
    if (releaseTarget && /^\d+\.\d+/.test(releaseTarget)) {
        const [, era] = releaseTarget.match(/^(\d+\.\d+)/)
        return era
    }
    return releaseTarget
}

async function setupMatchEnv(manifest, versionA, versionB) {
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
    const eraB = getEra(versionB)
    const matchDir = eraB ? path.resolve('matches', eraB) : path.resolve('matches')
    const matchFile = path.resolve(matchDir, `${versionA}#${versionB}.match`)
    if (!fs.existsSync(matchFile)) {
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
            lines.push(`\tnon-obf ${type} ${side}\tpaulscode|jcraft`)
        }
        lines.push('c\tLdummy;\tLdummy;', '')
        mkdirp(path.dirname(matchFile))
        fs.writeFileSync(matchFile, lines.join('\n'))
        return true
    }
    return false
}

async function getVersionInfo(manifest, id) {
    const info = manifest.versions.find(v => v.omniId === id)
    if (!info) {
        console.error(`${id} not found`)
        return
    }
    return JSON.parse(fs.readFileSync(path.resolve(versionDataDir, info.url)))
}

function getVersionDetails(id) {
    return JSON.parse(fs.readFileSync(path.resolve(versionDataDir, 'version', id + '.json')))
}

async function getMainJar(version, id) {
    const dir = path.resolve('versions', id)
    const files = []
    for (const key in version.downloads) {
        const download = version.downloads[key]
        if (!download.url.endsWith('.jar')) continue
        const file = path.resolve(dir, key + '.jar')
        files.push(file)
        await downloadFile(download.url, file)
    }
    if (files.length > 2) throw Error('More than 2 jar downloads, that\'s unexpected')
    if (files.length === 0) throw Error('Expected at least one jar')
    const merged = path.resolve(`libraries/com/mojang/minecraft/${id}/minecraft-${id}.jar`)
    if (fs.existsSync(merged)) return merged
    mkdirp(path.dirname(merged))
    if (files.length === 2) {
        throw Error('TODO: merge jars')
    } else {
        fs.linkSync(files[0], merged)
    }
    return merged
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