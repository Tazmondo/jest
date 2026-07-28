import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packagesRoot = path.join(repositoryRoot, "Packages");
const indexRoot = path.join(packagesRoot, "_Index");
const workspaceRoot = path.join(packagesRoot, "_Workspace");
const upstreamRoot = path.resolve(process.argv[2] ?? "");
const upstreamSourceRoot = path.join(upstreamRoot, "src");

function assertWithin(parent, target) {
	const relative = path.relative(parent, target);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`Refusing to modify path outside ${parent}: ${target}`);
	}
}

async function copyLuauTree(source, destination) {
	await fs.mkdir(destination, { recursive: true });

	for (const entry of await fs.readdir(source, { withFileTypes: true })) {
		const sourcePath = path.join(source, entry.name);
		if (entry.isDirectory()) {
			await copyLuauTree(sourcePath, path.join(destination, entry.name));
		} else if (entry.isFile() && entry.name.endsWith(".lua")) {
			const destinationName = `${entry.name.slice(0, -4)}.luau`;
			await fs.copyFile(sourcePath, path.join(destination, destinationName));
		}
	}
}

function exportedTypes(source) {
	const exports = [];
	const declaration = /^export type\s+([A-Za-z_][A-Za-z0-9_]*)(?:<([^>\r\n]+)>)?\s*=/gm;

	for (const match of source.matchAll(declaration)) {
		const [, name, genericDeclaration] = match;
		const genericArguments = genericDeclaration
			?.split(",")
			.map((parameter) => parameter.trim().match(/^([A-Za-z_][A-Za-z0-9_]*(?:\.\.\.)?)/)?.[1])
			.filter(Boolean);
		exports.push({
			name,
			genericDeclaration,
			genericArguments,
		});
	}

	return exports;
}

async function targetModuleSource(indexName, packageName) {
	const root = indexName === "_Workspace" ? workspaceRoot : indexRoot;
	const candidates = [
		path.join(root, packageName, packageName, "init.luau"),
		path.join(root, packageName, `${packageName}.luau`),
	];

	for (const candidate of candidates) {
		try {
			return await fs.readFile(candidate, "utf8");
		} catch (error) {
			if (error.code !== "ENOENT") {
				throw error;
			}
		}
	}

	return undefined;
}

async function packageLink(indexName, packageName, depth) {
	const moduleSource = await targetModuleSource(indexName, packageName);
	if (moduleSource === undefined) {
		return undefined;
	}

	const typeForwards = exportedTypes(moduleSource)
		.map(({ name, genericDeclaration, genericArguments }) => {
			const declaration = genericDeclaration ? `<${genericDeclaration}>` : "";
			const argumentsList = genericArguments?.length ? `<${genericArguments.join(", ")}>` : "";
			return `export type ${name}${declaration} = Package.${name}${argumentsList}`;
		})
		.join("\n");

	return `--[[
\tPackage link generated from the Jest Roblox v3.19.0 manifests
]]
local PackageIndex = script${".Parent".repeat(depth)}.${indexName}

local Package = require(PackageIndex["${packageName}"]["${packageName}"])

${typeForwards}

return Package
`;
}

async function writeLink(packageName, alias, targetName, indexName, development = false) {
	const packageRoot = path.join(workspaceRoot, packageName);
	const linkRoot = development ? path.join(packageRoot, "Dev") : packageRoot;
	const target = path.join(linkRoot, `${alias}.luau`);
	const source = await packageLink(indexName, targetName, development ? 4 : 3);
	if (source === undefined) {
		if (development) {
			console.warn(`Skipping unavailable dev dependency ${packageName}/${alias} -> ${targetName}`);
			return;
		}
		throw new Error(`Could not find installed dependency ${targetName} in ${indexName}`);
	}

	assertWithin(workspaceRoot, target);
	await fs.mkdir(linkRoot, { recursive: true });
	await fs.writeFile(target, source, "utf8");
}

function manifestDependencies(manifest, sectionName) {
	const dependencies = [];
	let section;

	for (const line of manifest.split(/\r?\n/)) {
		const sectionMatch = line.match(/^\[([^\]]+)\]$/);
		if (sectionMatch) {
			section = sectionMatch[1];
			continue;
		}
		if (section !== sectionName) {
			continue;
		}

		const dependencyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
		if (dependencyMatch) {
			dependencies.push({
				alias: dependencyMatch[1],
				definition: dependencyMatch[2],
			});
		}
	}

	return dependencies;
}

async function patchPesdeParentRequire() {
	const resolverPath = path.join(
		workspaceRoot,
		"JestRuntime",
		"JestRuntime",
		"resolveInstancePath.luau",
	);
	const original = await fs.readFile(resolverPath, "utf8");
	const restriction = /if prevPathPart and prevPathPart ~= pathPart then(?=\r?\n)/;
	const matches = original.match(new RegExp(restriction.source, "g"));
	if (matches?.length !== 1) {
		throw new Error(`Could not find the expected parent-path restriction in ${resolverPath}`);
	}

	await fs.writeFile(
		resolverPath,
		original.replace(
			restriction,
			'if prevPathPart and prevPathPart ~= pathPart and prevPathPart ~= "." then',
		),
		"utf8",
	);
}

const workspaceManifest = await fs.readFile(path.join(upstreamRoot, "rotriever.toml"), "utf8");
if (!workspaceManifest.includes('version = "3.19.0"')) {
	throw new Error(`Expected Jest Roblox v3.19.0 at ${upstreamRoot}`);
}

const packages = [];
const packageBySourceRoot = new Map();
for (const directory of await fs.readdir(upstreamSourceRoot, { withFileTypes: true })) {
	if (!directory.isDirectory()) {
		continue;
	}

	const sourcePackageRoot = path.join(upstreamSourceRoot, directory.name);
	const manifestPath = path.join(sourcePackageRoot, "rotriever.toml");
	let manifest;
	try {
		manifest = await fs.readFile(manifestPath, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") {
			continue;
		}
		throw error;
	}

	const packageName = manifest.match(/^name = "([^"]+)"$/m)?.[1];
	if (!packageName) {
		throw new Error(`Could not read package name from ${manifestPath}`);
	}

	const packageInfo = {
		name: packageName,
		manifest,
		sourceRoot: sourcePackageRoot,
	};
	packages.push(packageInfo);
	packageBySourceRoot.set(path.normalize(sourcePackageRoot).toLowerCase(), packageInfo);
	const destination = path.join(workspaceRoot, packageName, packageName);
	assertWithin(workspaceRoot, destination);
	await fs.rm(destination, { recursive: true, force: true });
	await copyLuauTree(path.join(sourcePackageRoot, "src"), destination);
}

// Pesde package links use require("./../package/version/name"), while upstream
// v3.19 only accepts "../..." or consecutive leading parent segments.
await patchPesdeParentRequire();

for (const obsoletePackage of ["Emittery", "JestJasmine2"]) {
	const workspacePackage = path.join(workspaceRoot, obsoletePackage);
	const publicLink = path.join(packagesRoot, `${obsoletePackage}.luau`);
	assertWithin(workspaceRoot, workspacePackage);
	assertWithin(packagesRoot, publicLink);
	await fs.rm(workspacePackage, { recursive: true, force: true });
	await fs.rm(publicLink, { force: true });
}

for (const packageInfo of packages) {
	const packageRoot = path.join(workspaceRoot, packageInfo.name);
	for (const entry of await fs.readdir(packageRoot, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".luau")) {
			await fs.rm(path.join(packageRoot, entry.name));
		}
	}
	await fs.rm(path.join(packageRoot, "Dev"), { recursive: true, force: true });
}

for (const packageInfo of packages) {
	for (const development of [false, true]) {
		const sectionName = development ? "dev_dependencies" : "dependencies";
		for (const dependency of manifestDependencies(packageInfo.manifest, sectionName)) {
			const pathMatch = dependency.definition.match(/\bpath\s*=\s*["']([^"']+)["']/);
			let indexName = "_Index";
			let targetName = dependency.alias;

			if (pathMatch) {
				indexName = "_Workspace";
				const dependencyRoot = path.resolve(packageInfo.sourceRoot, pathMatch[1]);
				const targetPackage = packageBySourceRoot.get(path.normalize(dependencyRoot).toLowerCase());
				if (!targetPackage) {
					throw new Error(
						`Could not resolve ${packageInfo.name}/${dependency.alias} to ${dependencyRoot}`,
					);
				}
				targetName = targetPackage.name;
			}

			await writeLink(
				packageInfo.name,
				dependency.alias,
				targetName,
				indexName,
				development,
			);
		}
	}
}

for (const packageInfo of packages) {
	const target = path.join(packagesRoot, `${packageInfo.name}.luau`);
	const source = await packageLink("_Workspace", packageInfo.name, 1);
	if (source === undefined) {
		throw new Error(`Could not generate public link for ${packageInfo.name}`);
	}
	await fs.writeFile(target, source, "utf8");
}

console.log(`Synchronized ${packages.length} Jest Roblox v3.19.0 workspace packages.`);
