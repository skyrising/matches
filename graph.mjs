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
    for (const {a, b, file} of matches) {
        let label = ''
        const status = fs.readFileSync(file, 'utf8').split('\n')[0]
        const matched = status.match(/c:(\d+)\/(\d+) m:(\d+)\/(\d+) f:(\d+)\/(\d+) ma:(\d+)\/(\d+)/)
        if (matched) {
            const c = +matched[1]/+matched[2]
            const m = +matched[3]/+matched[4]
            const f = +matched[5]/+matched[6]
            const ma = +matched[7]/+matched[8]
            const mean = Math.pow(c * m * f * ma, 1 / 4)
            label = (Math.round(mean * 1e4) / 1e2) + '%'
        }
        lines.push(`  ${versions[a].id} -> ${versions[b].id}[label="${label}",href="${path.relative(MATCHES_DIR, file).replace('#', '%23')}"];`)
    }
    lines.push('}')
    fs.writeFileSync(path.resolve(MATCHES_DIR, 'matches.dot'), lines.join('\n') + '\n')
}

dumpGraph()