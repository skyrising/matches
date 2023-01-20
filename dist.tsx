#!/usr/bin/env -S deno run --no-check=remote --allow-run --allow-read --allow-write
import './mc-versions/types.d.ts'

import * as path from 'https://deno.land/std@0.113.0/path/mod.ts'
import React from 'https://esm.sh/react@17.0.2'
import {renderToStaticMarkup} from 'https://esm.sh/react-dom@17.0.2/server'
import {getEra, spawnText, byKey, multiMapAdd, getOrPut} from './utils.ts'

type VersionType = 'client' | 'server' | 'merged'

type MatchData = {
    a: string
    b: string
    file: string
}

type VersionInfo = {
    id: string
    type: VersionType
    version: string
    era: string
}

type MatchStatus = {
    c: [number, number]
    m: [number, number]
    f: [number, number]
    ma: [number, number]
}

type Data = {
    matches: MatchData[]
    versions: Record<string, VersionInfo>
    versionsByEra: Record<string, string[]>
    existingVersions: Record<string, VersionData>
    statusByFile: Record<string, MatchStatus>
}

const MATCHES_DIR = 'matches'
const DIST_DIR = 'dist'
const TEMPLATE_DIR = 'template'

const COLORS: Record<string, string> = {
    'cm': '#008800',
    'mc': '#880000',
    'sm': '#0088ff',
    'ms': '#8800ff',
    'cs': '#888800',
    'sc': '#8888ff',
    'ss': '#0000aa'
}

function getTypes(dir: string, a: string, b: string) {
    if (dir === 'cross') {
        return [splitVersionAndType(a), splitVersionAndType(b)]
    }
    return [[dir, a], [dir, b]]
}

async function getData(): Promise<Data> {
    const matches = []
    const versions: Record<string, VersionInfo> = {}
    const files = (await spawnText(['git', 'ls-files', '-z', '*.match'])).split('\0')
    files.sort()
    for (const file of files) {
        if (!file.startsWith(MATCHES_DIR + '/')) continue
        const [a, b] = path.basename(file, '.match').split('#')
        const rel = path.relative(MATCHES_DIR, file)
        const [[typeA, versionA], [typeB, versionB]] = getTypes(rel.slice(0, rel.indexOf('/')), a, b)
        const keyA = typeA + '-' + versionA
        const keyB = typeB + '-' + versionB
        matches.push({a: keyA, b: keyB, file})
        let id = keyB.replace(/[-.~]/g, '_')
        if (/^\d/.test(id)) id = 'v' + id
        versions[keyB] = {id, type: typeB as VersionType, version: versionB, era: await getEra(versionB)}
        if (!versions[keyA]) {
            let aId = keyA.replace(/[-.~]/g, '_')
            if (/^\d/.test(aId)) aId = 'v' + aId
            versions[keyA] = {id: aId, type: typeA as VersionType, version: versionA, era: await getEra(versionA)}
        }
    }
    const existingVersions: VersionData[] = []
    for await (const file of Deno.readDir('mc-versions/data/version')) {
        if (!file.isFile || !file.name.endsWith('.json')) continue
        const versionData: VersionData = JSON.parse(await Deno.readTextFile(path.resolve('mc-versions/data/version/', file.name)))
        existingVersions.push(versionData)
    }
    existingVersions.sort((a, b) => Date.parse(a.releaseTime) - Date.parse(b.releaseTime))
    const versionsByEra: Record<string, string[]> = {}
    for (const version of Object.values(existingVersions)) {
        const era = await getEra(version.id, version)
        const types = []
        const merged = version.client && version.server && version.sharedMappings
        if (merged) types.push('merged')
        if (version.client && !merged) types.push('client')
        if (version.server && !merged) types.push('server')
        for (const type of types) {
            multiMapAdd(versionsByEra, era, type + '-' + version.id)
        }
    }
    const statusByFile: Record<string, MatchStatus> = {}
    await Promise.all(matches.map(async ({file}) => {
        const status = (await spawnText(['git', 'show', `HEAD:${file}`])).split('\n')[0]
        const matched = status.match(/c:(\d+)\/(\d+) m:(\d+)\/(\d+) f:(\d+)\/(\d+) ma:(\d+)\/(\d+)/)
        if (matched) {
            statusByFile[file] = {
                c: [+matched[1], +matched[2]],
                m: [+matched[3], +matched[4]],
                f: [+matched[5], +matched[6]],
                ma: [+matched[7], +matched[8]]
            }
        }
    }))
    return {
        matches, versions, versionsByEra, existingVersions: byKey(existingVersions, v => v.id), statusByFile
    }
}

function splitVersionAndType(id: string): [VersionType|undefined, string] {
    if (id.startsWith('client-')) return ['client', id.slice(7)]
    if (id.startsWith('server-')) return ['server', id.slice(7)]
    if (id.startsWith('merged-')) return ['merged', id.slice(7)]
    return [undefined, id]
}

function weightedGeoMean(values: number[], weights: number[]) {
    let product = 1
    let weightSum = 0
    for (let i = 0; i < values.length; i++) {
        product *= values[i] ** weights[i]
        weightSum += weights[i]
    }
    return product ** (1 / weightSum)
}

async function dumpGraph(data: Data) {
    const {matches, versions, versionsByEra, statusByFile} = data
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
            const v = versions[key]
            if (!v) continue
            const {id, type, version} = v
            const typePrefix = type === 'merged' ? '' : type[0].toUpperCase() + type.slice(1) + ' '
            lines.push(`    ${id}[label="${typePrefix}${version}",href="https://skyrising.github.io/mc-versions/version/${version}.json"];`)
        }
        lines.push('  }')
    }
    for (const {a, b, file} of matches) {
        let label = ''
        const status = statusByFile[file]
        if (status) {
            const c = status.c[0] / status.c[1]
            const m = status.m[0] / status.m[1]
            const f = status.f[0] / status.f[1]
            const ma = status.ma[0] / status.ma[1]
            const mean = weightedGeoMean([c, m, f, ma], [2, 1, 1, 0.25])
            label = (Math.round(mean * 1e4) / 1e2) + '%'
        }
        const typeA = versions[a].type
        const typeB = versions[b].type
        const color = typeA && typeB ? COLORS[typeA[0] + typeB[0]] : undefined
        const attr: Record<string, string|undefined> = {
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
    await Deno.writeTextFile(path.resolve(DIST_DIR, 'matches.dot'), lines.join('\n') + '\n')
}

function compareEras(a: string, b: string) {
    const order = ['pre-classic', 'classic', 'indev', 'infdev', 'alpha', 'beta']
    const aIndex = order.indexOf(a)
    const bIndex = order.indexOf(b)
    if (aIndex >= 0 && bIndex >= 0 && aIndex !== bIndex) return aIndex - bIndex
    if (aIndex >= 0 && bIndex < 0) return -1
    if (aIndex < 0 && bIndex >= 0) return 1
    if (a.startsWith('1.') && b.startsWith('1.')) return Number(a.slice(2)) - Number(b.slice(2))
    return a > b ? 1 : a < b ? -1 : 0
}

type ProgressBarSection = {
    title: string
    amount: number
    color: string
}

function ProgressBar(props: {sections: ProgressBarSection[], height: string}) {
    return <div className='progress-bar'>
        {props.sections.map(s => <div title={s.title} style={{
            width: `${100 * s.amount}%`,
            backgroundColor: s.color,
            height: props.height
        }}></div>)}
    </div>
}

const COLOR_MATCHED_CLASSES = '#18b55d'
const COLOR_MATCHED_METHODS = '#18c55d'
const COLOR_MATCHED_FIELDS = '#18d55d'
const COLOR_MATCHED_METHOD_ARGS = '#18e55d'
const COLOR_UNMATCHED_CLASSES = '#980f43'
const COLOR_UNMATCHED_METHODS = '#a80f43'
const COLOR_UNMATCHED_FIELDS = '#b80f43'
const COLOR_UNMATCHED_METHOD_ARGS = '#c80f43'

function MatchProgress(props: {match: MatchData, status: MatchStatus|undefined}) {
    const {match, status} = props
    if (!status) return <></>
    function Bar(props: {name: string, values: [number, number], matchedColor: string, unmatchedColor: string}) {
        const {name, values, matchedColor, unmatchedColor} = props
        return <ProgressBar height='20px' sections={[
            {title: `Matched ${name}: ${values[0]} / ${values[1]}`, color: matchedColor, amount: values[0] / values[1]},
            {title: `Unmatched ${name}: ${values[1] - values[0]} / ${values[1]}`, color: unmatchedColor, amount: 1 - values[0] / values[1]}
        ]} />
    }
    return <div>
        <span className='incoming'>{match.a}</span>
        <Bar name='classes' values={status.c} matchedColor={COLOR_MATCHED_CLASSES} unmatchedColor={COLOR_UNMATCHED_CLASSES} />
        <Bar name='methods' values={status.m} matchedColor={COLOR_MATCHED_METHODS} unmatchedColor={COLOR_UNMATCHED_METHODS} />
        <Bar name='fields' values={status.f} matchedColor={COLOR_MATCHED_FIELDS} unmatchedColor={COLOR_UNMATCHED_FIELDS} />
        <Bar name='method arguments' values={status.ma} matchedColor={COLOR_MATCHED_METHOD_ARGS} unmatchedColor={COLOR_UNMATCHED_METHOD_ARGS} />
    </div>
}

async function dumpIndexHtml(data: Data) {
    const {matches, versionsByEra, existingVersions, statusByFile} = data
    const matchesByVersion: Record<string, {incoming: MatchData[], outgoing: MatchData[]}> = {}
    for (const match of matches) {
        getOrPut(matchesByVersion, match.a, {incoming: [], outgoing: []}).outgoing.push(match)
        getOrPut(matchesByVersion, match.b, {incoming: [], outgoing: []}).incoming.push(match)
    }
    function Version(props: {id: string}) {
        const {id} = props
        const matches = matchesByVersion[id] ?? {incoming: [], outgoing: []}
        const version = existingVersions[id.slice(7)]
        return <>
            <h3 id={id}><a href={'#' + id}>§</a> <span>{id.slice(0, 6)}</span> {version.id}</h3>
            <aside className='incoming'>{matches.incoming.length}</aside>
            <aside className='outgoing'>{matches.outgoing.length}</aside>
            <div className='matches'>
                {matches.incoming.map(match => <MatchProgress match={match} status={statusByFile[match.file]} />)}
            </div>
        </>
    }
    const template = await Deno.readTextFile(path.resolve(TEMPLATE_DIR, 'index.html'))
    const sections: Element[] = []
    for (const era of Object.keys(versionsByEra).sort(compareEras)) {
        const section = <section>
            <h2>{era}</h2>
            {versionsByEra[era].map(s => <li className='version'><Version id={s} /></li>)}
        </section>
        sections.push(section)
    }
    const rendered = renderToStaticMarkup(<React.Fragment children={sections} />)
    await Deno.writeTextFile(path.resolve(DIST_DIR, 'index.html'), template.replace('$$VERSIONS$$', rendered))
}

async function dumpJson(data: Data) {
    await Deno.writeTextFile(path.resolve(DIST_DIR, 'matches.json'), JSON.stringify({
        matches: data.matches,
        versions: data.versions
    }, null, 2))
}

async function generate() {
    const data = await getData()
    await dumpGraph(data)
    await dumpIndexHtml(data)
    await dumpJson(data)
}

generate().catch(console.error)