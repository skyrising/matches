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
        let [typeA, versionA] = splitVersionAndType(a)
        let [typeB, versionB] = splitVersionAndType(b)
        let rel = path.relative(MATCHES_DIR, file)
        if (!typeA && !typeB) {
            typeA = typeB = rel.slice(0, rel.indexOf('/'))
        }
        const keyA = typeA + '-' + versionA
        const keyB = typeB + '-' + versionB
        matches.push({a: keyA, b: keyB, file})
        let id = keyB.replace(/[-.~]/g, '_')
        if (/^\d/.test(id)) id = 'v' + id
        versions[keyB] = {id, type: typeB, version: versionB, era: await getEra(versionB)}
        if (!versions[keyA]) {
            let aId = keyA.replace(/[-.~]/g, '_')
            if (/^\d/.test(aId)) aId = 'v' + aId
            versions[keyA] = {id: aId, type: typeA, version: versionA, era: await getEra(versionA)}
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
        for (const key of versionsByEra[era]) {
            const {id, type, version} = versions[key]
            const typePrefix = type === 'merged' ? '' : type[0].toUpperCase() + type.slice(1) + ' '
            lines.push(`    ${id}[label="${typePrefix}${version}",href="https://skyrising.github.io/mc-versions/version/${version}.json"];`)
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
        const typeA = versions[a].type
        const typeB = versions[b].type
        const color = typeA && typeB ? COLORS[typeA[0] + typeB[0]] : undefined
        const attr = {
            label,
            color,
            href: path.relative(MATCHES_DIR, file).replace('#', '%23')
        }
        const attrStr = Object.keys(attr)
            .map(k => attr[k] && (k + '="' + attr[k] + '"'))
            .filter(Boolean)
            .join(',')
        lines.push(`  ${versions[a].id} -> ${versions[b].id}[${attrStr}];`)
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