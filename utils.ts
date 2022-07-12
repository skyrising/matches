import './mc-versions/types.d.ts'

import * as path from 'https://deno.land/std@0.113.0/path/mod.ts'

const versionDataDir = path.resolve('mc-versions', 'data')

export async function spawnText(cmd: string[]) {
    const cp = Deno.run({cmd, stdout: 'piped'})
    const text = new TextDecoder().decode(await cp.output())
    const {code} = await cp.status()
    if (code) throw code
    return text
}

const ERAS: Record<string, string> = {
    inf: 'infdev',
    in: 'indev',
    af: 'april-fools',
    a: 'alpha',
    'server-a': 'alpha',
    b: 'beta',
    combat: 'combat',
    c: 'classic',
    'server-c': 'classic',
    rd: 'pre-classic'
}

export async function getEra(version: string, data?: VersionData) {
    for (const key in ERAS) {
        if (version.startsWith(key)) return ERAS[key]
    }
    const releaseTarget = (data || await getVersionDetails(version)).releaseTarget
    if (releaseTarget && /^\d+\.\d+/.test(releaseTarget)) {
        const [, era] = releaseTarget.match(/^(\d+\.\d+)/) as string[]
        return era
    }
    return releaseTarget as string
}

export async function getVersionDetails(id: string): Promise<VersionData> {
    return JSON.parse(await Deno.readTextFile(path.resolve(versionDataDir, 'version', id + '.json')))
}

export function byKey<T>(array: T[], key: (v: T) => string): Record<string, T> {
    const obj: Record<string, T> = {}
    for (const v of array) {
        obj[key(v)] = v
    }
    return obj
}

export function multiMapAdd<V>(map: Record<string, V[]>, key: string, value: V) {
    let vs = map[key]
    if (!vs) map[key] = vs = []
    vs.push(value)
}

export function getOrPut<V>(map: Record<string, V>, k: string, v: V) {
    const prev = map[k]
    if (prev) return prev
    return map[k] = v
}