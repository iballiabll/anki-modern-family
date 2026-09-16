import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const materialsRoot = path.join(root, "materials");
const manifestPath = path.join(root, "resources.json");
const checkOnly = process.argv.includes("--check");
const supportedExtensions = new Map([
  [".csv", "anki-csv"],
  [".md", "markdown-table"],
]);

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function cleanTitle(value) {
  return value
    .replace(/^\d{4}-\d{2}-\d{2}[-_\s]+/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function encodeAssetPath(relativePath) {
  return relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function makeId(relativePath) {
  const readable = relativePath
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = createHash("sha1")
    .update(relativePath)
    .digest("hex")
    .slice(0, 8);
  return `${readable || "material"}-${suffix}`;
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN"),
  )) {
    if (entry.name.startsWith(".") || entry.name === "README.md") {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath)));
      continue;
    }

    if (
      entry.isFile() &&
      supportedExtensions.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

function buildResource(absolutePath) {
  const relativePath = toPosixPath(path.relative(materialsRoot, absolutePath));
  const pathParts = relativePath.split("/");
  const fileName = pathParts.pop();
  const extension = path.extname(fileName).toLowerCase();
  const fileTitle = cleanTitle(path.basename(fileName, extension));
  const folderParts = pathParts.map(cleanTitle).filter(Boolean);
  const group = folderParts.at(-1) || "未分类素材";
  const titleParts = folderParts.slice(0, -1).concat(fileTitle);
  const title = titleParts.join(" · ") || fileTitle;

  return {
    id: makeId(relativePath),
    title,
    group,
    description: [group, fileTitle].filter(Boolean).join(" · "),
    file: `./materials/${encodeAssetPath(relativePath)}`,
    format: supportedExtensions.get(extension),
  };
}

function serializeManifest(resources) {
  return `${JSON.stringify(
    {
      siteName: "iball的小屋",
      generatedFrom: "materials",
      resources,
    },
    null,
    2,
  )}\n`;
}

await fs.mkdir(materialsRoot, { recursive: true });
const files = await walk(materialsRoot);
const resources = files.map(buildResource);
const nextManifest = serializeManifest(resources);

if (checkOnly) {
  const currentManifest = await fs
    .readFile(manifestPath, "utf8")
    .catch(() => "");
  if (currentManifest !== nextManifest) {
    console.error("resources.json is stale. Run npm run build.");
    process.exit(1);
  }
  console.log(`Manifest is current with ${resources.length} material(s).`);
} else {
  await fs.writeFile(manifestPath, nextManifest, "utf8");
  console.log(`Generated resources.json with ${resources.length} material(s).`);
}
