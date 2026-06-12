import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GOV_ROOT = join(process.cwd(), "governance", "ava007");

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function assertSingleXmlRoot(content: string, filePath: string): void {
  const trimmed = content.trim();
  const rootMatch = trimmed.match(/^<([A-Za-z_][\w:-]*)(\s[^>]*)?>[\s\S]*<\/\1>\s*$/);
  expect(rootMatch, `Expected single XML root in ${filePath}`).not.toBeNull();

  const rootTag = rootMatch?.[1] ?? "";
  const openTagCount = (trimmed.match(new RegExp(`<${rootTag}(\\s|>)`, "g")) ?? []).length;
  expect(openTagCount, `Duplicate top-level root tag ${rootTag} in ${filePath}`).toBe(1);
}

describe("Ava007 governance integrity", () => {
  it("ensures governance XML files have single canonical roots", async () => {
    const files = await listFiles(GOV_ROOT);
    const xmlFiles = files.filter((file) => file.endsWith(".xml"));

    for (const file of xmlFiles) {
      const content = await readFile(file, "utf8");
      assertSingleXmlRoot(content, file);
    }
  });

  it("ensures all assembly includes resolve", async () => {
    const assembliesDir = join(GOV_ROOT, "assemblies");
    const assemblyFiles = (await listFiles(assembliesDir)).filter((file) => file.endsWith(".xml"));

    for (const assemblyFile of assemblyFiles) {
      const content = await readFile(assemblyFile, "utf8");
      const includes = [...content.matchAll(/<include>([^<]+)<\/include>/g)].map((match) => match[1]);

      for (const includePath of includes) {
        const resolved = join(GOV_ROOT, includePath);
        const includeContent = await readFile(resolved, "utf8");
        expect(includeContent.length).toBeGreaterThan(0);
      }
    }
  });

  it("ensures canonical authority order is consistent", async () => {
    const policyAuthority = await readFile(join(GOV_ROOT, "policies", "authority-order.xml"), "utf8");
    const systemAuthority = await readFile(join(GOV_ROOT, "system", "authority-stack.xml"), "utf8");
    const governanceMd = await readFile(join(GOV_ROOT, "AVA007_RUNTIME_GOVERNANCE.md"), "utf8");

    const policyOrder = [...policyAuthority.matchAll(/<rule priority="\d+">([^<]+)<\/rule>/g)].map((m) =>
      m[1].trim(),
    );

    const stackOrderBlock = systemAuthority.match(/<stack_order>([\s\S]*?)<\/stack_order>/);
    expect(stackOrderBlock).not.toBeNull();

    const systemOrder = [...(stackOrderBlock?.[1].matchAll(/<layer index="\d+">([^<]+)<\/layer>/g) ?? [])].map((m) =>
      m[1].trim(),
    );

    expect(policyOrder).toEqual(["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"]);
    expect(systemOrder).toEqual(["JSONL", "Tashi", "Neo4j", "GSAP", "Runtime"]);
    expect(governanceMd).toMatch(/JSONL\s*>\s*Tashi\s*>\s*Neo4j\s*>\s*GSAP\s*>\s*Runtime/);
    expect(governanceMd).not.toMatch(/JSONL\s*>\s*Tashi\s*>\s*GSAP\s*>\s*Neo4j\s*>\s*Runtime/);
  });

  it("ensures no duplicate policy or runtime identifiers", async () => {
    const policyFiles = (await listFiles(join(GOV_ROOT, "policies"))).filter((file) => file.endsWith(".xml"));
    const runtimeFiles = (await listFiles(join(GOV_ROOT, "runtime"))).filter((file) => file.endsWith(".xml"));

    const policyIds = new Set<string>();
    for (const file of policyFiles) {
      const content = await readFile(file, "utf8");
      const idMatch = content.trim().match(/^<([A-Za-z_][\w:-]*)/);
      expect(idMatch).not.toBeNull();
      const id = idMatch?.[1] ?? "";
      expect(policyIds.has(id), `Duplicate policy root id: ${id}`).toBe(false);
      policyIds.add(id);
    }

    const runtimeModes = new Set<string>();
    for (const file of runtimeFiles) {
      const content = await readFile(file, "utf8");
      const modeMatch = content.match(/<runtime mode="([^"]+)">/);
      expect(modeMatch).not.toBeNull();
      const mode = modeMatch?.[1] ?? "";
      expect(runtimeModes.has(mode), `Duplicate runtime mode id: ${mode}`).toBe(false);
      runtimeModes.add(mode);
    }
  });
});
