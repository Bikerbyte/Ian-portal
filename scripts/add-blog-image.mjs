import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const usage = `
Usage:
  npm run image:blog -- <post-md> <image> [more-images...] [--alt "Alt text"] [--after "Heading text"]

Examples:
  npm run image:blog -- src/content/blog/iac-monitoring-system.md C:\\shots\\state.png --alt "Terraform state list"
  npm run image:blog -- src/content/blog/iac-monitoring-system.md C:\\shots\\state.png --after "Terraform State 檢查"
`;

function parseArgs(argv) {
  const options = {
    alt: "",
    after: ""
  };
  const values = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--alt" || arg === "--after") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} needs a value.`);
      }

      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }

    values.push(arg);
  }

  return { options, values };
}

function slugify(value, fallback) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function nextAvailableFile(targetDirectory, filename) {
  const extension = path.extname(filename);
  const baseName = path.basename(filename, extension);
  let candidate = filename;
  let count = 2;

  while (existsSync(path.join(targetDirectory, candidate))) {
    candidate = `${baseName}-${count}${extension}`;
    count += 1;
  }

  return candidate;
}

function insertAfterHeading(markdown, headingText, insertion) {
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const target = headingText.trim().replace(/^#+\s*/, "");
  const index = lines.findIndex((line) => {
    const trimmed = line.trim();
    const normalizedHeading = trimmed.replace(/^#+\s*/, "");

    return trimmed === headingText.trim() || normalizedHeading === target;
  });

  if (index === -1) {
    throw new Error(`Cannot find heading: ${headingText}`);
  }

  lines.splice(index + 1, 0, "", insertion);
  return lines.join(newline);
}

try {
  const { options, values } = parseArgs(process.argv.slice(2));

  if (values.length < 2) {
    console.log(usage.trim());
    process.exit(1);
  }

  const [postPath, ...imagePaths] = values;
  const absolutePostPath = path.resolve(postPath);

  if (!existsSync(absolutePostPath)) {
    throw new Error(`Post not found: ${postPath}`);
  }

  for (const imagePath of imagePaths) {
    if (!existsSync(path.resolve(imagePath))) {
      throw new Error(`Image not found: ${imagePath}`);
    }
  }

  const postSlug = path.basename(postPath, path.extname(postPath));
  const targetDirectory = path.resolve("public", "images", "blog", postSlug);
  mkdirSync(targetDirectory, { recursive: true });

  const snippets = imagePaths.map((imagePath, index) => {
    const absoluteImagePath = path.resolve(imagePath);
    const extension = path.extname(imagePath).toLowerCase();
    const imageBaseName = slugify(path.basename(imagePath, extension), `image-${index + 1}`);
    const filename = nextAvailableFile(targetDirectory, `${imageBaseName}${extension}`);
    const destination = path.join(targetDirectory, filename);

    copyFileSync(absoluteImagePath, destination);

    const alt = options.alt || path.basename(imagePath, extension).replace(/[-_]+/g, " ");
    return `![${alt}](../../images/blog/${postSlug}/${filename})`;
  });

  if (options.after) {
    const markdown = readFileSync(absolutePostPath, "utf8");
    const updatedMarkdown = insertAfterHeading(markdown, options.after, snippets.join("\n\n"));
    writeFileSync(absolutePostPath, updatedMarkdown);
    console.log(`Inserted ${snippets.length} image(s) into ${postPath}.`);
  } else {
    console.log("Image markdown:");
    console.log(snippets.join("\n\n"));
  }

  console.log(`Copied image(s) to ${path.relative(process.cwd(), targetDirectory)}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
