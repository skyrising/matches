import fs from 'fs'
import path from 'path'
import cp from 'child_process'

const versionDataDir = path.resolve('mc-versions', 'data')
const versionDir = path.resolve(versionDataDir, 'version')

export function spawn(program, args, opts) {
    return new Promise((resolve, reject) => {
        const c = cp.spawn(program, args, opts)
        c.on('exit', code => {
            if (code) reject(code)
            else resolve(code)
        })
    })
}

export function spawnText(program, args, opts) {
    return new Promise((resolve, reject) => {
        const buffers = []
        const c = cp.spawn(program, args, opts)
        c.stdout.on('data', buf => buffers.push(buf))
        c.on('exit', code => {
            if (code) reject(code)
            else resolve(Buffer.concat(buffers).toString('utf8'))
        })
    })
}

const ERAS = {
    inf: 'infdev',
    in: 'indev',
    af: 'april-fools',
    a: 'alpha',
    b: 'beta',
    c: 'classic',
    rd: 'pre-classic'
}

export function getEra(version) {
    for (const key in ERAS) {
        if (version.startsWith(key)) return ERAS[key]
    }
    const releaseTarget = getVersionDetails(version).releaseTarget
    if (releaseTarget && /^\d+\.\d+/.test(releaseTarget)) {
        const [, era] = releaseTarget.match(/^(\d+\.\d+)/)
        return era
    }
    return releaseTarget
}

export function getVersionDetails(id) {
    return JSON.parse(fs.readFileSync(path.resolve(versionDataDir, 'version', id + '.json')))
}