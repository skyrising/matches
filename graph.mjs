import fs from 'fs'
import path from 'path'
import {getEra, spawnText} from './utils.mjs'

const MATCHES_DIR = 'matches'
const DIST_DIR = 'dist'

const COLORS = {
    'cm': '#008800',
    'mc': '#880000',
    'sm': '#0088ff',
    'ms': '#8800ff',
    'cs': '#888800',
    'sc': '#8888ff',
    'ss': '#0000aa'
}

async function dumpGraph() {
    const matches = []
    const versions = {}
    const files = (await spawnText('git', ['ls-files', '-z', '*.match'])).split('\0')
    files.sort()
    for (const file of files) {
        if (!file.startsWith(MATCHES_DIR + '/')) continue
        const [a, b] = path.basename(file, '.match').split('#')
        matches.push({a, b, file})
        const [typeA, versionA] = splitVersionAndType(a)
        const [typeB, versionB] = splitVersionAndType(b)
        let id = versionB.replace(/[-.~]/g, '_')
        if (/^\d/.test(id)) id = 'v' + id
        versions[versionB] = {id, era: await getEra(versionB)}
        if (!versions[versionA]) {
            let aId = versionA.replace(/[-.~]/g, '_')
            if (/^\d/.test(aId)) aId = 'v' + aId
            versions[versionA] = {id: aId, era: await getEra(versionA)}
        }
    }
    const versionsByEra = {}
    for (const version in versions) {
        const {era} = versions[version]
        ;(versionsByEra[era] = versionsByEra[era] || []).push(version)
    }
    const lines = [
        'digraph {',
        '  fontname="sans-serif";',
        '  concentrate=true;',
        '  node[shape="box",fontname="sans-serif"];',
        '  edge[fontname="sans-serif"];'
    ]
    for (const era in versionsByEra) {
        lines.push(`  subgraph cluster_${era.replace(/[-.~]/g, '_')} {`)
        lines.push(`    label="${era}";`)
        for (const version of versionsByEra[era]) {
            const {id} = versions[version]
            lines.push(`    ${id}[label="${version}",href="https://skyrising.github.io/mc-versions/version/${version}.json"];`)
        }
        lines.push('  }')
    }
    const statusByFile = {}
    await Promise.all(matches.map(async ({file}) => {
        statusByFile[file] = (await spawnText('git', ['show', `HEAD:${file}`])).split('\n')[0]
    }))
    for (const {a, b, file} of matches) {
        let label = ''
        const status = statusByFile[file]
        const matched = status.match(/c:(\d+)\/(\d+) m:(\d+)\/(\d+) f:(\d+)\/(\d+) ma:(\d+)\/(\d+)/)
        if (matched) {
            const c = +matched[1]/+matched[2]
            const m = +matched[3]/+matched[4]
            const f = +matched[5]/+matched[6]
            const ma = +matched[7]/+matched[8]
            const mean = weightedGeoMean([c, m, f, ma], [2, 1, 1, 0.25])
            label = (Math.round(mean * 1e4) / 1e2) + '%'
        }
        let [typeA, versionA] = splitVersionAndType(a)
        let [typeB, versionB] = splitVersionAndType(b)
        const rel = path.relative(MATCHES_DIR, file)
        if (!typeA && !typeB) {
            typeA = typeB = rel.slice(0, rel.indexOf('/'))
        }
        const color = typeA && typeB ? COLORS[typeA[0] + typeB[0]] : undefined
        const attr = {
            label,
            color,
            href: rel.replace('#', '%23')
        }
        const attrStr = Object.keys(attr)
            .map(k => attr[k] && (k + '="' + attr[k] + '"'))
            .filter(Boolean)
            .join(',')
        lines.push(`  ${versions[versionA].id} -> ${versions[versionB].id}[${attrStr}];`)
    }
    lines.push('}')
    fs.writeFileSync(path.resolve(DIST_DIR, 'matches.dot'), lines.join('\n') + '\n')
}

function splitVersionAndType(id) {
    if (id.startsWith('client-')) return ['client', id.slice(7)]
    if (id.startsWith('server-')) return ['server', id.slice(7)]
    if (id.startsWith('merged-')) return ['merged', id.slice(7)]
    return [undefined, id]
}

function weightedGeoMean(values, weights) {
    let product = 1
    let weightSum = 0
    for (let i = 0; i < values.length; i++) {
        product *= values[i] ** weights[i]
        weightSum += weights[i]
    }
    return product ** (1 / weightSum)
}

dumpGraph().catch(console.error)