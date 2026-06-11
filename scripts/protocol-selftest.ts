/**
 * Protocol self-test —— 「:::指令行」叙事协议解析器的回归套件。
 *
 * 运行：npx tsx scripts/protocol-selftest.ts
 *
 * 覆盖（对应任务 V 的 a–f）：
 *   a. 完整文档全字段精确断言
 *   b. 流式三处截断（指令行中间 / 正文行中间 / say 行后无正文）不抛错、残行规则
 *   c. <think> 包裹（完整 + 流式未闭合）思考内容不漏入任何字段
 *   d. 容错（未知指令忽略、裸正文并入 narration、interact 缺字段 / sentiment 非法、空对白丢弃）
 *   e. 探测回退（纯 JSON → isProtocolResponse=false 且 parseNarrationResponse 走老路；全垃圾 → failed）
 *   f. 提示词互恰：从 buildWorldSystemPrompt 输出里截取示例文档喂解析器，锚定文法不漂移
 *
 * 注意：本脚本只断言解析器行为，绝不为了过测试反向修改解析器语义。
 */

import assert from 'node:assert/strict';
import {
  isProtocolResponse,
  extractProtocolStreamingState,
  parseProtocolFinal,
} from '../src/lib/narration_protocol';
import { parseNarrationResponse } from '../src/lib/narrator-browser';
import { buildWorldSystemPrompt } from '../src/lib/prompts/dialogue-runtime';
import type {
  ParsedStory,
  PlayerConfig,
  GuardrailParams,
  NarrativeBalance,
} from '../src/lib/types';
import type { RenderedSelection } from '../src/lib/prompts/dialogue-runtime';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

// —— 一份完整、规范的协议文档（多段 narration + 两个 say + choice/choice! + 全字段 interact）——
const FULL_DOC = `:::narration
雨水顺着屋檐砸下来。巷口的灯笼晃了两晃，灭了。
阿明把伞收紧，认出了那个背影。
:::narration
雷声在远处滚过。
:::say 阿明
这么晚了，你怎么会在这里？
:::say 小红
我来找你。
:::choice 如实说出自己的来意
:::choice 谎称只是路过
:::choice! 转身就走，装作没看见他
:::interact 阿明 | neutral | 在巷口偶遇玩家 | 警觉地打量玩家
:::end
`;

// ===== a. 完整文档：各字段精确断言 =====
test('a. parseProtocolFinal 完整文档全字段精确', () => {
  assert.equal(isProtocolResponse(FULL_DOC), true, '应被识别为协议响应');
  const r = parseProtocolFinal(FULL_DOC);

  // 多段 narration 按序以 \n 拼接，整体 trim。
  assert.equal(
    r.narration,
    '雨水顺着屋檐砸下来。巷口的灯笼晃了两晃，灭了。\n阿明把伞收紧，认出了那个背影。\n雷声在远处滚过。',
    'narration 应按序拼接两段',
  );

  // 两个 say：speaker / content 精确。
  assert.equal(r.dialogues.length, 2);
  assert.deepEqual(r.dialogues[0], { speaker: '阿明', content: '这么晚了，你怎么会在这里？' });
  assert.deepEqual(r.dialogues[1], { speaker: '小红', content: '我来找你。' });

  // 三个 choice：第三个是分支点。
  assert.equal(r.choices.length, 3);
  assert.deepEqual(r.choices[0], { text: '如实说出自己的来意', isBranchPoint: false });
  assert.deepEqual(r.choices[1], { text: '谎称只是路过', isBranchPoint: false });
  assert.deepEqual(r.choices[2], { text: '转身就走，装作没看见他', isBranchPoint: true });

  // interact 全字段。
  assert.equal(r.interactions.length, 1);
  assert.deepEqual(r.interactions[0], {
    characterName: '阿明',
    sentiment: 'neutral',
    event: '在巷口偶遇玩家',
    reaction: '警觉地打量玩家',
  });
});

// ===== b. 流式切割：三处截断 =====
test('b1. 流式截断于「指令行中间」—— 残行暂扣', () => {
  // 截在 ":::say 阿明" 的中间（":::sa"）。已完结的两段 narration 应可见，残行不并入。
  const idx = FULL_DOC.indexOf(':::say 阿明');
  const buf = FULL_DOC.slice(0, idx) + ':::sa';
  let state!: ReturnType<typeof extractProtocolStreamingState>;
  assert.doesNotThrow(() => { state = extractProtocolStreamingState(buf); });
  assert.equal(
    state.narration,
    '雨水顺着屋檐砸下来。巷口的灯笼晃了两晃，灭了。\n阿明把伞收紧，认出了那个背影。\n雷声在远处滚过。',
    '已完结 narration 正确',
  );
  // 半截指令行被暂扣：不应产生对白，也不应把 ":::sa" 当正文混入 narration。
  assert.equal(state.dialogues.length, 0, '半截 say 指令不应生成对白');
  assert.ok(!state.narration.includes('sa'), '残行指令不应混入正文');
});

test('b2. 流式截断于「正文行中间」—— 残行立即可见', () => {
  // 在第一段 narration 第二行写到一半截断。narration/say 正文残行应立即可见（协议核心优势）。
  const buf = `:::narration
雨水顺着屋檐砸下来。
阿明把伞收`;
  let state!: ReturnType<typeof extractProtocolStreamingState>;
  assert.doesNotThrow(() => { state = extractProtocolStreamingState(buf); });
  assert.equal(state.narration, '雨水顺着屋檐砸下来。\n阿明把伞收', '正文残行应立即上屏');
});

test('b3. 流式截断于「say 行后无正文」—— 末对白标 partial', () => {
  // 文档刚写完 ":::say 阿明\n"，对白正文尚未到达。
  const buf = `:::narration
开场。
:::say 阿明
`;
  let state!: ReturnType<typeof extractProtocolStreamingState>;
  assert.doesNotThrow(() => { state = extractProtocolStreamingState(buf); });
  assert.equal(state.narration, '开场。');
  assert.equal(state.dialogues.length, 1);
  assert.equal(state.dialogues[0].speaker, '阿明');
  assert.equal(state.dialogues[0].content, '', '正文未到，content 为空');
  assert.equal(state.dialogues[0].partial, true, '仍开启的末对白应标 partial');
});

test('b4. 正文残行以「:」开头时暂扣（可能正在形成指令）', () => {
  // 规范第 5 条：残行以 ":" 开头时暂扣不显示。
  const buf = `:::narration
第一行。
:`;
  const state = extractProtocolStreamingState(buf);
  assert.equal(state.narration, '第一行。', '以冒号开头的残行应被暂扣');
});

// ===== c. <think> 包裹：思考内容绝不漏入任何字段 =====
test('c1. 完整 <think> 块被剥离，思考不漏入字段', () => {
  const buf = `<think>我先盘算一下：玩家想干嘛，阿明该怎么反应。：：：这不是指令。</think>
:::narration
正文开始。
:::say 阿明
你好。
:::choice 行动一
:::interact 阿明 | positive | 打招呼 | 微笑回应`;
  const r = parseProtocolFinal(buf);
  const blob = JSON.stringify(r);
  assert.ok(!blob.includes('盘算'), '思考内容不应出现在任何字段');
  assert.equal(r.narration, '正文开始。');
  assert.equal(r.dialogues.length, 1);
  assert.equal(r.dialogues[0].content, '你好。');
});

test('c2. 流式未闭合 <think> 被整段剥离', () => {
  // 思考尚未闭合，其后没有真正答案；解析结果应为空且无思考残留。
  const buf = `:::narration
还没开始想。
<think>正在思考，玩家选择了 A，那么`;
  const state = extractProtocolStreamingState(buf);
  // 流式不 trim（设计如此），但 <think> 整段必须被剥离：思考文字一字不漏入字段。
  assert.equal(state.narration.trim(), '还没开始想。', '未闭合 think 之后的内容应被丢弃');
  assert.ok(!JSON.stringify(state).includes('正在思考'), '思考不漏入流式字段');
});

// ===== d. 容错 =====
test('d1a. 无开启段时未知指令行整行忽略（向前兼容）', () => {
  const buf = `:::narration
正文。
:::end
:::wobble 这是未来才有的指令
:::say 阿明
对白。`;
  const r = parseProtocolFinal(buf);
  assert.equal(r.narration, '正文。', '段外未知指令不并入 narration');
  assert.equal(r.dialogues.length, 1);
  assert.equal(r.dialogues[0].content, '对白。', '未知指令不打断后续 say');
});

test('d1b. 开启段内的未知 ::: 行按正文保留（引用语法不被吞）', () => {
  const buf = `:::say 阿明
你看这张纸上写着：
:::这不是任何已知指令
就照着念吧。`;
  const r = parseProtocolFinal(buf);
  assert.equal(r.dialogues.length, 1);
  assert.ok(r.dialogues[0].content.includes(':::这不是任何已知指令'), '对白内的未知 ::: 行应保留为正文');
  assert.ok(r.dialogues[0].content.includes('就照着念吧。'), '后续正文不受影响');
});

test('d2. 无头裸正文并入 narration', () => {
  // 文档开头没有 :::narration，但有裸文本行（模型忘写头部）。
  // 注意：必须含一条 :::say 才能被 isProtocolResponse 判为协议；裸正文走容错并入 narration。
  const buf = `这是一段没有头部的叙事。
继续这段。
:::say 阿明
对白。`;
  const r = parseProtocolFinal(buf);
  assert.equal(r.narration, '这是一段没有头部的叙事。\n继续这段。', '裸正文应并入 narration');
  assert.equal(r.dialogues[0].content, '对白。');
});

test('d3. interact 缺字段补空 + sentiment 非法归一 neutral', () => {
  const buf = `:::say 阿明
喂。
:::interact 阿明 | 暴怒 | 只有两段`;
  const r = parseProtocolFinal(buf);
  assert.equal(r.interactions.length, 1);
  assert.deepEqual(r.interactions[0], {
    characterName: '阿明',
    sentiment: 'neutral',     // "暴怒" 非合法值 → neutral
    event: '只有两段',
    reaction: '',             // 第四段缺失 → 空串
  });
});

test('d4. 空对白（无正文且已被关闭）在终态丢弃', () => {
  // 阿明的 say 后无正文，立刻被下一条 narration 关闭 → 终态应丢弃这条空对白。
  const buf = `:::say 阿明
:::narration
随后的叙事。
:::say 小红
真正的对白。`;
  const r = parseProtocolFinal(buf);
  assert.equal(r.dialogues.length, 1, '空对白应被丢弃');
  assert.deepEqual(r.dialogues[0], { speaker: '小红', content: '真正的对白。' });
});

// ===== e. 探测回退：纯 JSON 走老路；全垃圾 → failed =====
function makeMockStory(): ParsedStory {
  return {
    id: 'mock-story',
    title: '测试故事',
    originalText: '',
    summary: '一个用于自测的最小故事。',
    worldSetting: { era: '现代', genre: '都市', rules: ['无超自然'], toneDescription: '平实' },
    characters: [
      { id: 'c-aming', name: '阿明', description: '', personality: '', background: '', relationships: [], isOriginal: true },
    ],
    locations: [],
    keyEvents: [
      { id: 'e0', title: '初遇', description: '雨夜巷口。', timeIndex: 0, involvedCharacterIds: [] },
    ],
    timelineDescription: '',
  };
}

test('e1. 纯 JSON 响应 isProtocolResponse=false 且走 legacy 产出 entries', () => {
  const json = JSON.stringify({
    narration: '老路解析的叙事。',
    dialogues: [{ speaker: '阿明', content: 'JSON 对白。' }],
    choices: [{ text: '选项A', isBranchPoint: false }],
    interactions: [{ characterName: '阿明', event: '聊天', reaction: '点头', sentiment: 'positive' }],
  });
  assert.equal(isProtocolResponse(json), false, '纯 JSON 不应被判为协议');
  const out = parseNarrationResponse(json, makeMockStory(), '我走上前');
  assert.equal(out.failed, false);
  // 一条 narration entry + 一条 dialogue entry。
  assert.equal(out.entries.length, 2);
  assert.equal(out.entries[0].type, 'narration');
  assert.equal(out.entries[0].content, '老路解析的叙事。');
  assert.equal(out.entries[1].type, 'dialogue');
  assert.equal(out.entries[1].speaker, '阿明');
  // choices 挂在最后一条 entry 上。
  assert.equal(out.entries[1].choices?.length, 1);
  // interaction 与 story.characters 匹配。
  assert.equal(out.interactions.length, 1);
  assert.equal(out.interactions[0].characterName, '阿明');
});

test('e2. 全垃圾输入 → failed=true 且 entries 空', () => {
  const garbage = 'asdf @@@ %%% 这不是 JSON 也不是协议 ::: 没有合法头部 ::::: !!!';
  assert.equal(isProtocolResponse(garbage), false);
  const out = parseNarrationResponse(garbage, makeMockStory(), '随便');
  assert.equal(out.failed, true, '垃圾输入应 failed');
  assert.equal(out.entries.length, 0, 'entries 应为空');
});

// ===== f. 提示词互恰：示例文档 ↔ 解析器 文法回归锚点 =====
test('f. 提示词示例文档可被解析器精确解析（文法不漂移）', () => {
  const story = makeMockStory();
  const playerConfig: PlayerConfig = { entryMode: 'soul-transfer', characterId: 'c-aming', entryEventIndex: 0 };
  const guardrail: GuardrailParams = { temperature: 0.7, strictness: 0.5 };
  const balance: NarrativeBalance = { narrativeWeight: 50 };
  const rendered: RenderedSelection = { detailedLines: '', rosterLines: '', detailedLocations: [] };

  const prompt = buildWorldSystemPrompt(story, playerConfig, guardrail, balance, rendered);

  // 从 prompt 中截取「## 交互格式要求」段里的**示例文档**（不是上方的语法说明列表）。
  // 示例块位于 "示例（…）：" 之后；取其后从 :::narration 到 :::interact 行（含）的整块。
  // 用 "示例" 标记定位，避免误命中前面逐条解释指令的语法说明段。
  const exampleSection = prompt.slice(prompt.indexOf('示例'));
  const m = exampleSection.match(/:::narration\n[\s\S]*?:::interact[^\n]*/);
  assert.ok(m, 'prompt 中应能找到示例文档');
  const example = m![0];

  assert.equal(isProtocolResponse(example), true, '示例应被识别为协议');
  const r = parseProtocolFinal(example);

  // 1 段 narration（可能多行，但只有一个 :::narration 头）。
  assert.ok(r.narration.length > 0, 'narration 非空');
  // 1 条对白，speaker = 阿明。
  assert.equal(r.dialogues.length, 1, '示例应有 1 条对白');
  assert.equal(r.dialogues[0].speaker, '阿明', 'speaker 应为阿明');
  // 3 个 choice，第 3 个是分支点。
  assert.equal(r.choices.length, 3, '示例应有 3 个 choice');
  assert.equal(r.choices[0].isBranchPoint, false);
  assert.equal(r.choices[1].isBranchPoint, false);
  assert.equal(r.choices[2].isBranchPoint, true, '第 3 个 choice 应为分支点');
  // 1 条 interact。
  assert.equal(r.interactions.length, 1, '示例应有 1 条 interact');
  assert.equal(r.interactions[0].characterName, '阿明');
});

// ===== g. 终审回归：误路由防护 + 交错时序保持 =====
test('g1. JSON 字符串值里含行首 :::narration 不会误路由到协议解析', () => {
  const jsonWithProtocolLines = `{
  "narration": "他展开纸条，上面写着：\\n:::narration\\n奇怪的咒文",
  "dialogues": []
}`;
  assert.equal(isProtocolResponse(jsonWithProtocolLines), false, '以 { 开头的响应应判为 JSON 形');
  // 真实换行版本（更危险的形态）同样不误判。
  const jsonRealNewlines = '{\n"narration": "第一行\n:::say 阿明\n第二行"\n}';
  assert.equal(isProtocolResponse(jsonRealNewlines), false);
  // 代码围栏包裹的 JSON 同样判为 JSON 形。
  assert.equal(isProtocolResponse('```json\n{"narration":"x"}\n```'), false);
  // 脏前缀（散文 + 协议）仍应命中协议。
  assert.equal(isProtocolResponse('好的，我来继续。\n:::narration\n雨夜。'), true);
});

test('g2. narration 与 say 交错时 blocks 保留文档序', () => {
  const buf = `:::narration
开场旁白。
:::say 阿明
第一句话。
:::narration
他说完，转身离开。
:::say 小红
等等！`;
  const r = parseProtocolFinal(buf);
  assert.equal(r.blocks.length, 4, '应有 4 个保序块');
  assert.deepEqual(r.blocks.map(b => b.type), ['narration', 'dialogue', 'narration', 'dialogue']);
  assert.equal(r.blocks[2].type, 'narration');
  assert.equal((r.blocks[2] as { content: string }).content, '他说完，转身离开。');
  // 兼容投影仍可用。
  assert.equal(r.dialogues.length, 2);
  assert.ok(r.narration.includes('开场旁白。') && r.narration.includes('转身离开'));
});

test('g3. parseNarrationResponse 按 blocks 文档序生成 entries', () => {
  const story = makeMockStory();
  const buf = `:::narration
开场旁白。
:::say 阿明
第一句话。
:::narration
他说完，转身离开。
:::choice 跟上去`;
  const out = parseNarrationResponse(buf, story, '测试输入');
  assert.equal(out.failed, false);
  assert.deepEqual(
    out.entries.map(e => e.type),
    ['narration', 'dialogue', 'narration'],
    'entries 应保持 叙事→对白→叙事 的文档序',
  );
  assert.equal(out.entries[2].content, '他说完，转身离开。');
  // choices 仍挂在最后一个 entry 上。
  assert.equal(out.entries[2].choices?.length, 1);
});

console.log(`\nAll ${passed} protocol self-tests PASSED.`);
