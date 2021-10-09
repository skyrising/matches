import fs from 'fs'
import path from 'path'
import {spawn} from './utils.mjs'

const MATCHES_DIR = 'matches'

function dumpGraph() {
    const matchEras = fs.readdirSync(MATCHES_DIR)
    const matches = []
    const versions = {}
    for (const era of matchEras) {
        const eraDir = path.resolve(MATCHES_DIR, era)
        if (!fs.statSync(eraDir).isDirectory()) continue
        for (const matchFile of fs.readdirSync(eraDir)) {
            if (!matchFile.endsWith('.match')) continue
            const [a, b] = matchFile.slice(0, matchFile.length - 6).split('#')
            matches.push({a, b, file: path.resolve(eraDir, matchFile)})
            let id = b.replace(/[-.~]/g, '_')
            if (/^\d/.test(id)) id = 'v' + id
            versions[b] = {id, era}
            if (!versions[a]) {
                let aId = a.replace(/[-.~]/g, '_')
                if (/^\d/.test(id)) aId = 'v' + aId
                versions[a] = {id: aId, era}
            }
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
        '  node[shape="box",fontname="sans-serif"];'
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
    for (const {a, b, file} of matches) {
        lines.push(`  ${versions[a].id} -> ${versions[b].id}[href="${path.relative(MATCHES_DIR, file).replace('#', '%23')}"];`)
    }
    lines.push('}')
    fs.writeFileSync(path.resolve(MATCHES_DIR, 'matches.dot'), lines.join('\n') + '\n')
}

dumpGraph()