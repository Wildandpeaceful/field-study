import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const vendorRoot = path.join(projectRoot, "public", "vendor", "lucide");
const iconDirectory = path.join(vendorRoot, "icons");
const tags = JSON.parse(await readFile(path.join(vendorRoot, "tags.json"), "utf8"));
const sourcePackage = JSON.parse(await readFile(path.join(vendorRoot, "source-package.json"), "utf8"));

const filenames = (await readdir(iconDirectory))
  .filter((filename) => filename.endsWith(".svg"))
  .sort((left, right) => left.localeCompare(right));

const icons = filenames.map((filename) => {
  const name = filename.slice(0, -4);
  return {
    name,
    label: name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" "),
    tags: tags[name] || [],
    file: `icons/${filename}`,
  };
});

const manifest = {
  schemaVersion: 1,
  library: "Lucide",
  package: sourcePackage.name,
  version: sourcePackage.version,
  license: sourcePackage.license,
  homepage: sourcePackage.homepage,
  count: icons.length,
  assetBase: "/vendor/lucide/",
  generatedFrom: "lucide-static",
  icons,
};

await writeFile(
  path.join(vendorRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Lucide manifest: ${icons.length} icons (${sourcePackage.version})`);
