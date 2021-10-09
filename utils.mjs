import cp from 'child_process'

export function spawn(program, args, opts) {
    return new Promise((resolve, reject) => {
        const c = cp.spawn(program, args, opts)
        c.on('exit', code => {
            if (code) reject(code)
            else resolve(code)
        })
    })
}