#!/usr/bin/env tsx
/**
 * build-preset: convert a story text file into an app-loadable preset.
 *
 * Pipes a local `.txt` / `.md` file through the same `parseStoryClient`
 * that the browser uses (incremental graph build, chunk cache, retry,
 * polish) and emits a TypeScript module containing a complete
 * `ParsedStory`. The resulting file can be imported by
 * `src/lib/presets/index.ts` and rendered on the home-page preset tab.
 *
 * Usage
 * -----
 *   npm run build-preset -- \
 *     --input ./my-story.txt \
 *     --slug three-body \
 *     --title "三体" \
 *     --tagline "三颗恒星下的文明" \
 *     --chips "近未来,硬科幻,哲学"
 *
 * All paths are taken as relative to the current working directory.
 *
 * LLM connection
 * --------------
 *   --provider  openai | anthropic   (default: openai)
 *   --model     model name           (default: gpt-4o / claude-sonnet-4-20250514)
 *   --base-url  custom API endpoint  (e.g. DeepSeek / Moonshot / OpenRouter)
 *   --api-key   override the env-provided key
 *
 * The script reads the key from these environment variables if no
 * `--api-key` is passed: OPENAI_API_KEY (openai), ANTHROPIC_API_KEY
 * (anthropic).
 *
 * Output
 * ------
 * By default writes to `src/lib/presets/<slug>.ts`. Override with
 * `--out <path>`.
 *
 * IDs in the emitted ParsedStory are rewritten from runtime UUIDs to
 * stable slugs (`preset:<slug>` / `char:c01` / `loc:l01` / `event:e01`)
 * so the preset's identity survives app reloads. The original entity
 * name is included as a JS comment above each entry to keep the file
 * readable by humans.
 *
 * After writing, the script reminds you to register the preset in
 * `src/lib/presets/index.ts` (PRESETS array) — it does not auto-edit
 * that file to keep the operation boring and reviewable.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Agent, setGlobalDispatcher } from 'undici';
import { parseStoryClient } from '../src/lib/parser-client';
import type {
  ParsedStory, Character, KeyEvent, Location, LLMProvider,
  WorldEntity, Faction, Relationship, LoreEntry, TimelineEvent,
  IPProject,
} from '../src/lib/types';

// Node 22 + some upstream LLM endpoints (DeepSeek among them) trip a TLS
// race that surfaces as `fetch failed ECONNRESET` 30-50 ms into the call.
// curl / Python urllib are unaffected because they handle dual-stack
// resolution differently. Forcing a known-good undici Agent with explicit
// IPv4 + generous keep-alive timeouts sidesteps the issue without
// regressing other providers.
setGlobalDispatcher(new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connect: { timeout: 30_000, family: 4 },
  bodyTimeout: 180_000,
  headersTimeout: 60_000,
}));

// ----- tiny arg parser ----------------------------------------------------
type Args = {
  input: string;
  slug: string;
  title: string;
  tagline?: string;
  chips?: string[];
  out?: string;
  provider: LLMProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { provider: 'openai', help: false };
  const want = new Set(['input', 'slug', 'title', 'tagline', 'chips', 'out', 'provider', 'model', 'base-url', 'api-key']);
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '-h' || raw === '--help') { out.help = true; continue; }
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    if (!want.has(key)) {
      console.error(`⚠ 未知参数: --${key}`);
      process.exit(2);
    }
    const val = argv[++i];
    if (val === undefined) {
      console.error(`⚠ --${key} 缺少值`);
      process.exit(2);
    }
    switch (key) {
      case 'input':    out.input = val; break;
      case 'slug':     out.slug = val; break;
      case 'title':    out.title = val; break;
      case 'tagline':  out.tagline = val; break;
      case 'chips':    out.chips = val.split(',').map(s => s.trim()).filter(Boolean); break;
      case 'out':      out.out = val; break;
      case 'provider':
        if (val !== 'openai' && val !== 'anthropic') {
          console.error(`⚠ --provider 仅支持 openai | anthropic`);
          process.exit(2);
        }
        out.provider = val;
        break;
      case 'model':    out.model = val; break;
      case 'base-url': out.baseUrl = val; break;
      case 'api-key':  out.apiKey = val; break;
    }
  }
  return {
    help: out.help || false,
    input: out.input || '',
    slug: out.slug || '',
    title: out.title || '',
    tagline: out.tagline,
    chips: out.chips,
    out: out.out,
    provider: out.provider || 'openai',
    model: out.model,
    baseUrl: out.baseUrl,
    apiKey: out.apiKey,
  };
}

function printHelp(): void {
  console.log(`
build-preset — 把一段故事文本解析成 AI TokTok 的预设故事模块。

用法:
  npm run build-preset -- --input <file> --slug <slug> --title <title> [选项]

必填:
  --input <path>      故事原文文件（.txt / .md，相对 CWD）
  --slug  <slug>      预设 slug（用作 story id 与默认输出文件名）
  --title <title>     展示标题，例如 "绝命毒师"

可选:
  --tagline <text>    首页卡片上的一行简介
  --chips "a,b,c"     chips 数组（逗号分隔）
  --out <path>        输出路径（默认 src/lib/presets/<slug>.ts）

LLM 接入:
  --provider openai|anthropic     默认 openai
  --model   <model>               默认 gpt-4o / claude-sonnet-4-20250514
  --base-url <url>                自定义接口（DeepSeek / OpenRouter / 本地 Ollama…）
  --api-key  <key>                API 密钥（或从环境变量读取）

环境变量:
  OPENAI_API_KEY       openai 的默认密钥
  ANTHROPIC_API_KEY    anthropic 的默认密钥

示例:
  # 用 OpenAI
  OPENAI_API_KEY=sk-xxx npm run build-preset -- \\
    --input ./story.txt --slug three-body \\
    --title "三体" --tagline "三颗恒星下的文明" \\
    --chips "近未来,硬科幻,哲学"

  # 用 DeepSeek（OpenAI 兼容接口）
  OPENAI_API_KEY=sk-xxx npm run build-preset -- \\
    --input ./story.txt --slug my-tale --title "我的故事" \\
    --base-url https://api.deepseek.com/v1 --model deepseek-chat
`);
}

// ----- slug remapping -----------------------------------------------------

type IdMap = Map<string, string>;

function remapToSlugs(raw: ParsedStory, slug: string): ParsedStory {
  const storyId = `preset:${slug}`;

  const charMap: IdMap = new Map();
  const newCharacters: Character[] = raw.characters.map((c, i) => {
    const id = `char:c${String(i + 1).padStart(2, '0')}`;
    charMap.set(c.id, id);
    return { ...c, id };
  });
  // second pass: rewrite relationships.characterId
  for (const c of newCharacters) {
    c.relationships = c.relationships
      .map(r => ({ ...r, characterId: charMap.get(r.characterId) || r.characterId }))
      .filter(r => r.characterId.startsWith('char:'));
  }

  const locMap: IdMap = new Map();
  const newLocations: Location[] = raw.locations.map((l, i) => {
    const id = `loc:l${String(i + 1).padStart(2, '0')}`;
    locMap.set(l.id, id);
    return { ...l, id };
  });

  const eventMap: IdMap = new Map();
  const newEvents: KeyEvent[] = raw.keyEvents.map((e, i) => {
    const id = `event:e${String(i + 1).padStart(2, '0')}`;
    eventMap.set(e.id, id);
    return {
      ...e,
      id,
      involvedCharacterIds: e.involvedCharacterIds
        .map(cid => charMap.get(cid))
        .filter((s): s is string => !!s),
      locationId: e.locationId ? locMap.get(e.locationId) : undefined,
    };
  });

  // ---- Phase 2 derived tables --------------------------------------------
  // Project envelope: re-key to preset:<slug>; child rows reference the same id.
  const projectId = storyId;
  const newProject: IPProject | undefined = raw.project ? {
    ...raw.project,
    id: projectId,
    title: raw.title,
    updatedAt: Date.now(),
  } : undefined;

  // Entities are a union view across characters/locations/events/factions.
  // Reuse the slugs we already minted above when name+type matches; otherwise
  // assign a stable per-type slug.
  const factionMap: IdMap = new Map();
  const entityIdMap: IdMap = new Map();
  let factionCounter = 0;
  const newEntities: WorldEntity[] | undefined = raw.entities ? raw.entities.map((e) => {
    let id = e.id;
    if (e.type === 'character') {
      const match = newCharacters.find(c => c.name === e.name);
      if (match) id = match.id;
    } else if (e.type === 'location') {
      const match = newLocations.find(l => l.name === e.name);
      if (match) id = match.id;
    } else if (e.type === 'event') {
      const match = newEvents.find(ev => ev.title === e.name);
      if (match) id = match.id;
    } else if (e.type === 'faction') {
      factionCounter++;
      id = `fac:f${String(factionCounter).padStart(2, '0')}`;
      factionMap.set(e.id, id);
    } else {
      id = `ent:x${String(entityIdMap.size + 1).padStart(2, '0')}`;
    }
    entityIdMap.set(e.id, id);
    return { ...e, id, projectId };
  }) : undefined;

  // Factions live in their own table too; mint stable slugs and reuse the
  // entity-side faction slug when names line up.
  const newFactions: Faction[] | undefined = raw.factions ? raw.factions.map((f, i) => {
    const matchEntity = newEntities?.find(e => e.type === 'faction' && e.name === f.name);
    const id = matchEntity?.id || `fac:f${String(i + 1).padStart(2, '0')}`;
    factionMap.set(f.id, id);
    return {
      ...f,
      id,
      projectId,
      memberEntityIds: (f.memberEntityIds || [])
        .map(eid => entityIdMap.get(eid) || eid),
    };
  }) : undefined;

  // Relationships: re-key sourceEntityId / targetEntityId via the entity map
  // (which covers characters by character id since their slug is identical
  // to the entity slug).
  const relIdMap: IdMap = new Map();
  const newRelationships: Relationship[] | undefined = raw.relationships ? raw.relationships
    .map((r, i): Relationship | null => {
      const id = `rel:r${String(i + 1).padStart(2, '0')}`;
      relIdMap.set(r.id, id);
      const src = entityIdMap.get(r.sourceEntityId)
        || charMap.get(r.sourceEntityId)
        || r.sourceEntityId;
      const tgt = entityIdMap.get(r.targetEntityId)
        || charMap.get(r.targetEntityId)
        || r.targetEntityId;
      return {
        ...r,
        id, projectId,
        sourceEntityId: src,
        targetEntityId: tgt,
      };
    })
    .filter((x): x is Relationship => x !== null) : undefined;

  // LoreEntries: their relatedEntityIds may point at characters/factions/etc.
  const newLoreEntries: LoreEntry[] | undefined = raw.loreEntries ? raw.loreEntries.map((l, i) => ({
    ...l,
    id: `lore:l${String(i + 1).padStart(2, '0')}`,
    projectId,
    relatedEntityIds: (l.relatedEntityIds || [])
      .map(eid => entityIdMap.get(eid) || charMap.get(eid) || eid),
  })) : undefined;

  // TimelineEvents share ids with KeyEvents when titles align.
  const newTimelineEvents: TimelineEvent[] | undefined = raw.timelineEvents ? raw.timelineEvents.map((te) => {
    const matched = newEvents.find(ke => ke.title === te.title);
    return {
      ...te,
      id: matched?.id || eventMap.get(te.id) || te.id,
      projectId,
    };
  }) : undefined;

  return {
    id: storyId,
    title: raw.title,
    originalText: raw.originalText,
    summary: raw.summary,
    worldSetting: raw.worldSetting,
    characters: newCharacters,
    locations: newLocations,
    keyEvents: newEvents,
    timelineDescription: raw.timelineDescription,
    // Phase 2 additive fields — only emitted when present.
    project: newProject,
    entities: newEntities,
    factions: newFactions,
    relationships: newRelationships,
    loreEntries: newLoreEntries,
    timelineEvents: newTimelineEvents,
  };
}

// ----- TS module emission -------------------------------------------------

function camelCase(slug: string): string {
  return slug.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^./, c => c.toLowerCase());
}

function tsString(s: string): string {
  return JSON.stringify(s);
}

/** Emit a verbatim template literal, escaping backticks and ${...} */
function tsBacktick(s: string): string {
  return '`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
}

function emitTsModule(story: ParsedStory): string {
  const camel = camelCase(story.id.replace(/^preset:/, '')) + 'Story';
  const lines: string[] = [];
  lines.push(`import { ParsedStory } from '../types';`);
  lines.push('');
  lines.push(`/**`);
  lines.push(` * 预设故事：${story.title}`);
  lines.push(` *`);
  lines.push(` * 由 scripts/build-preset.ts 自动生成；请在 src/lib/presets/index.ts`);
  lines.push(` * 的 PRESETS 数组中注册才能出现在首页。`);
  lines.push(` */`);
  lines.push(`export const ${camel}: ParsedStory = {`);
  lines.push(`  id: ${tsString(story.id)},`);
  lines.push(`  title: ${tsString(story.title)},`);
  lines.push(`  originalText: ${tsBacktick(story.originalText)},`);
  lines.push(`  summary: ${tsString(story.summary)},`);
  lines.push(`  worldSetting: ${JSON.stringify(story.worldSetting, null, 2).replace(/\n/g, '\n  ')},`);

  // characters — one per block with a name comment
  lines.push(`  characters: [`);
  for (const c of story.characters) {
    lines.push(`    // ${c.name}`);
    lines.push(`    ${JSON.stringify(c, null, 2).replace(/\n/g, '\n    ')},`);
  }
  lines.push(`  ],`);

  lines.push(`  locations: [`);
  for (const l of story.locations) {
    lines.push(`    // ${l.name}`);
    lines.push(`    ${JSON.stringify(l, null, 2).replace(/\n/g, '\n    ')},`);
  }
  lines.push(`  ],`);

  lines.push(`  keyEvents: [`);
  for (const e of story.keyEvents) {
    lines.push(`    // ${e.title}`);
    lines.push(`    ${JSON.stringify(e, null, 2).replace(/\n/g, '\n    ')},`);
  }
  lines.push(`  ],`);

  lines.push(`  timelineDescription: ${tsString(story.timelineDescription)},`);

  // Phase 2 additive tables — only emit when populated. Keeping them
  // optional means presets generated under prompt v4 stay readable.
  if (story.project) {
    lines.push(`  project: ${JSON.stringify(story.project, null, 2).replace(/\n/g, '\n  ')},`);
  }
  if (story.entities && story.entities.length > 0) {
    lines.push(`  entities: [`);
    for (const e of story.entities) {
      lines.push(`    // [${e.type}] ${e.name}`);
      lines.push(`    ${JSON.stringify(e, null, 2).replace(/\n/g, '\n    ')},`);
    }
    lines.push(`  ],`);
  }
  if (story.factions && story.factions.length > 0) {
    lines.push(`  factions: [`);
    for (const f of story.factions) {
      lines.push(`    // ${f.name}`);
      lines.push(`    ${JSON.stringify(f, null, 2).replace(/\n/g, '\n    ')},`);
    }
    lines.push(`  ],`);
  }
  if (story.relationships && story.relationships.length > 0) {
    lines.push(`  relationships: [`);
    for (const r of story.relationships) {
      lines.push(`    ${JSON.stringify(r, null, 2).replace(/\n/g, '\n    ')},`);
    }
    lines.push(`  ],`);
  }
  if (story.loreEntries && story.loreEntries.length > 0) {
    lines.push(`  loreEntries: [`);
    for (const l of story.loreEntries) {
      lines.push(`    // ${l.title}`);
      lines.push(`    ${JSON.stringify(l, null, 2).replace(/\n/g, '\n    ')},`);
    }
    lines.push(`  ],`);
  }
  if (story.timelineEvents && story.timelineEvents.length > 0) {
    lines.push(`  timelineEvents: [`);
    for (const t of story.timelineEvents) {
      lines.push(`    // ${t.title}`);
      lines.push(`    ${JSON.stringify(t, null, 2).replace(/\n/g, '\n    ')},`);
    }
    lines.push(`  ],`);
  }

  lines.push(`};`);
  lines.push('');
  return lines.join('\n');
}

// ----- main ----------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.input || !args.slug || !args.title) {
    printHelp();
    if (!args.help) {
      console.error('\n⚠ 缺少必填参数 (--input / --slug / --title)');
      process.exit(2);
    }
    process.exit(0);
  }

  const apiKey = (args.apiKey
    || process.env[args.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY']
    || '').trim();
  if (!apiKey) {
    const envName = args.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    console.error(`⚠ 缺少 API 密钥。请通过 --api-key 或环境变量 ${envName} 提供。`);
    process.exit(2);
  }

  const defaultModel = args.provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514';
  const inputPath = path.resolve(process.cwd(), args.input);
  const outPath = path.resolve(process.cwd(), args.out || `src/lib/presets/${args.slug}.ts`);

  let text: string;
  try {
    text = await fs.readFile(inputPath, 'utf8');
  } catch (err) {
    console.error(`⚠ 无法读取文件 ${inputPath}:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.error(`▸ 故事原文:  ${inputPath}  (${text.length.toLocaleString()} chars)`);
  console.error(`▸ 模型:      ${args.provider} / ${args.model || defaultModel}${args.baseUrl ? ` @ ${args.baseUrl}` : ''}`);
  console.error(`▸ 输出位置:  ${outPath}`);
  console.error('');

  const config = {
    provider: args.provider,
    apiKey,
    model: args.model?.trim() || defaultModel,
    baseUrl: args.baseUrl?.trim() || undefined,
  };

  // Progress line (stderr, rewritable)
  let lastLine = '';
  const renderProgress = (line: string): void => {
    if (line === lastLine) return;
    lastLine = line;
    // Clear and redraw
    process.stderr.write(`\r\x1b[2K${line}`);
  };

  try {
    const raw = await parseStoryClient(config, text, (p) => {
      const label =
        p.phase === 'split'  ? '切片中'
        : p.phase === 'parse'  ? (p.total === 1 ? '解析中' : `第 ${p.current.toFixed(2)}/${p.total} 段`)
        : p.phase === 'polish' ? '统一润色'
        : p.phase === 'build'  ? '构建世界'
        : p.phase;
      const extras: string[] = [];
      if (p.characters !== undefined && p.characters > 0) extras.push(`${p.characters} 角色`);
      if (p.resumedFrom !== undefined) extras.push(`续传@${p.resumedFrom}`);
      if (p.retrying) extras.push(`重试#${p.retrying}`);
      renderProgress(`▸ ${label}${extras.length ? `  [${extras.join(' · ')}]` : ''}`);
    });
    process.stderr.write('\n');

    console.error(`▸ 解析完成: ${raw.characters.length} 角色 · ${raw.locations.length} 地点 · ${raw.keyEvents.length} 事件`);

    const slugged = remapToSlugs(raw, args.slug);
    const tsSource = emitTsModule(slugged);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, tsSource, 'utf8');

    console.error(`▸ 已写入:   ${outPath}`);
    console.error('');
    console.error(`下一步：在 src/lib/presets/index.ts 的 PRESETS 数组里注册：`);
    console.error('');
    const camel = camelCase(args.slug) + 'Story';
    const chips = args.chips && args.chips.length > 0 ? args.chips : ['待补充'];
    console.error(`    import { ${camel} } from './${args.slug}';`);
    console.error('');
    console.error(`    export const PRESETS: Preset[] = [`);
    console.error(`      ...,`);
    console.error(`      {`);
    console.error(`        id: ${JSON.stringify(args.slug)},`);
    console.error(`        displayTitle: ${JSON.stringify(args.title)},`);
    console.error(`        tagline: ${JSON.stringify(args.tagline || '')},`);
    console.error(`        chips: ${JSON.stringify(chips)},`);
    console.error(`        story: ${camel},`);
    console.error(`      },`);
    console.error(`    ];`);
    console.error('');
  } catch (err) {
    process.stderr.write('\n');
    console.error(`⚠ 解析失败:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
