let { Resolver } = require("@parcel/plugin")
let path = require("path")
let fetch = require("node-fetch")
let fs = require("fs/promises")
let mkdirp = require("mkdirp")
let { URL } = require("url")

let DONT_INCLUDE = { isExcluded: true }

const fileExists = async (path) => !!(await fs.stat(path).catch((e) => false))

module.exports = new Resolver({
    async resolve({ specifier, dependency, options }) {
        let my_temp_cave = path.join(options.cacheDir, ".net")

        await new Promise((resolve) => setTimeout(resolve, 10000))
        if (dependency.specifierType === "commonjs") {
            if (specifier === "process") {
                return { filePath: "/dev/null.js", code: "" }
            }
            if (specifier.startsWith("@parcel") || dependency.sourcePath.includes("node_modules/@parcel")) {
                return null
            }
            console.error(`Unrecognized commonjs import:`, dependency)
            return DONT_INCLUDE
        }

        // So yeah, our sample urls aren't real urls....
        if (specifier.startsWith("sample")) {
            return DONT_INCLUDE
        }

        // Translate my cool directory structure into a real url
        if (dependency.sourcePath?.startsWith?.(my_temp_cave)) {
            let [protocol, hostname, ...path] = dependency.sourcePath.slice(my_temp_cave.length).slice(1).split("/")
            let url_object = new URL(specifier, `${protocol}://${hostname}/${path.join("/")}`)
            specifier = url_object.toString()
        }

        if (specifier.startsWith("https://") || specifier.startsWith("http://")) {
            let url = new URL(specifier)

            if (url.port !== "") throw new Error(`Port in urls not supported yet (${specifier})`)
            if (url.hash !== "") throw new Error(`Hash in urls not supported yet (${specifier})`)
            if (url.username !== "") throw new Error(`Username in urls not supported (${specifier})`)
            if (url.password !== "") throw new Error(`Password in urls not supported (${specifier})`)

            // If no file extension is given in the URL, guess one automatically.
            let found_extension = /\.[a-zA-Z][a-zA-Z0-9]+$/.exec(url.pathname)?.[0]

            let extension_to_add = found_extension ?? (dependency.specifierType === "esm" ? ".mjs" : "")
            // If a search is given in the URL, this will search be appended to the path, so we need to repeat the extension.
            let should_add_extension = url.search !== "" || found_extension == null
            let suffix = should_add_extension ? extension_to_add : ""

            // Create a folder structure and file for the import. This folder structure will match the URL structure, to make sure that relative imports still work.
            let filename_parts = (url.pathname.slice(1) + encodeURIComponent(url.search) + suffix).split("/")
            let url_to_path = path.join(url.protocol.slice(0, -1), url.hostname, ...filename_parts)
            let fullpath = path.join(my_temp_cave, url_to_path)
            let folder = path.dirname(fullpath)

            if (!(await fileExists(fullpath))) {
                let response = await fetch(specifier)
                if (response.status !== 200) {
                    throw new Error(`${specifier} returned ${response.status}`)
                }
                // Can't directly use the value from the request, as parcel really wants a string,
                // and converting binary assets into strings and then passing them doesn't work 🤷‍♀️.
                let buffer = await response.buffer()

                await mkdirp(folder)
                await fs.writeFile(fullpath, buffer)
            }

            return { filePath: fullpath }
        }

        if (dependency.specifierType === "esm" || dependency.specifierType === "url") {
            return {
                filePath: path.join(path.dirname(dependency.sourcePath ?? "/"), specifier),
            }
        }

        console.error(`Dependency unrecognized:`, {
            specifier: dependency.specifier,
            specifierType: dependency.specifierType,
            sourcePath: dependency.sourcePath,
        })

        // This shouldn't lead to an error, but this does make the bundle unusable
        return DONT_INCLUDE
    },
})
