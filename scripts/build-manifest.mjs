import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const materialsRoot = path.join(root, "materials");
const manifestPath = path.join(root, "resources.json");
const publicRoot = path.join(root, "public");
const checkOnly = process.argv.includes("--check");
const staticEntries = [
  "app.js",
  "collocation-index.js",
  "collocation-index.json",
  "deck-data.js",
  "index.html",
  "intensive-data",
  "intensive.css",
  "intensive.html",
  "intensive-papers.js",
  "intensive.js",
  "movie-data",
  "movie.css",
  "movie.html",
  "movie.js",
  "reading.css",
  "reading.html",
  "reading.js",
  "resources.json",
  "review.css",
  "review.html",
  "review.js",
  "styles.css",
  "vocab-index.js",
  "vocab-index.json",
  "materials",
];
const categoryOrder = ["0基础", "四级", "六级", "考研", "电影", "其他"];
const supportedExtensions = new Map([
  [".csv", "anki-csv"],
  [".md", "markdown-table"],
  [".html", "html-page"],
  [".docx", "download-only"],
]);
const attachmentExtensions = new Set([".html", ".docx"]);

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function cleanTitle(value) {
  return value
    .replace(/^\d{4}-\d{2}-\d{2}[-_\s]+/, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFolderName(value) {
  return String(value || "").trim();
}

function compareCategoryNames(left, right) {
  const leftIndex = categoryOrder.indexOf(left);
  const rightIndex = categoryOrder.indexOf(right);

  if (leftIndex >= 0 && rightIndex >= 0) {
    return leftIndex - rightIndex;
  }
  if (leftIndex >= 0) {
    return -1;
  }
  if (rightIndex >= 0) {
    return 1;
  }
  return left.localeCompare(right, "zh-CN");
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

async function walkDirectories(directory, parentParts = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const directoryPaths = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN"),
  )) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const parts = [...parentParts, cleanFolderName(entry.name)].filter(Boolean);
    directoryPaths.push(parts);
    directoryPaths.push(
      ...(await walkDirectories(path.join(directory, entry.name), parts)),
    );
  }

  return directoryPaths;
}

async function buildCategories() {
  const directoryPaths = await walkDirectories(materialsRoot);
  const categories = new Map();

  for (const parts of directoryPaths) {
    const [categoryName, ...sectionParts] = parts;
    if (!categoryName) {
      continue;
    }

    if (!categories.has(categoryName)) {
      categories.set(categoryName, new Set());
    }

    if (sectionParts.length > 0) {
      categories.get(categoryName).add(sectionParts.join(" / "));
    }
  }

  return [...categories.entries()]
    .sort(([left], [right]) => compareCategoryNames(left, right))
    .map(([name, sections]) => ({
      name,
      sections: [...sections].sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      ),
    }));
}

function buildResource(absolutePath) {
  const relativePath = toPosixPath(path.relative(materialsRoot, absolutePath));
  const pathParts = relativePath.split("/");
  const fileName = pathParts.pop();
  const extension = path.extname(fileName).toLowerCase();
  const fileTitle = cleanTitle(path.basename(fileName, extension));
  const folderParts = pathParts.map(cleanFolderName).filter(Boolean);
  const category = folderParts[0] || "未分类素材";
  const section = folderParts.slice(1).join(" / ");

  return {
    id: makeId(relativePath),
    title: fileTitle,
    category,
    section,
    group: category,
    description: [category, section, fileTitle].filter(Boolean).join(" · "),
    file: `./materials/${encodeAssetPath(relativePath)}`,
    format: supportedExtensions.get(extension),
    attachment: attachmentExtensions.has(extension),
  };
}

function serializeManifest(resources, categories) {
  return `${JSON.stringify(
    {
      siteName: "iball的小屋",
      generatedFrom: "materials",
      categories,
      resources,
    },
    null,
    2,
  )}\n`;
}

async function buildPublicDirectory() {
  const resolvedRoot = path.resolve(root);
  const resolvedPublicRoot = path.resolve(publicRoot);
  if (
    resolvedPublicRoot === resolvedRoot ||
    !resolvedPublicRoot.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Refusing to clean output outside the project: ${publicRoot}`);
  }

  await fs.rm(publicRoot, { recursive: true, force: true });
  await fs.mkdir(publicRoot, { recursive: true });

  for (const entry of staticEntries) {
    const source = path.join(root, entry);
    const destination = path.join(publicRoot, entry);
    await fs.cp(source, destination, { recursive: true, force: true });
  }
}

await fs.mkdir(materialsRoot, { recursive: true });
const files = await walk(materialsRoot);
const resources = files.map(buildResource);
const categories = await buildCategories();
const nextManifest = serializeManifest(resources, categories);

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
  await buildPublicDirectory();
  console.log(`Generated resources.json with ${resources.length} material(s).`);
  console.log("Prepared public directory for deployment.");
}
