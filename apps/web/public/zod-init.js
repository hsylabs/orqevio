// Runs before the app's modules. The CSP forbids eval, and zod otherwise probes for it
// with `new Function` while schemas are created: browsers report even that caught
// attempt as a CSP violation. zod reads this setting when it loads.
globalThis.__zod_globalConfig = Object.assign(globalThis.__zod_globalConfig || {}, { jitless: true })
