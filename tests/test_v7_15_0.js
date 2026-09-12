#!/usr/bin/env node
'use strict';
// 独立读取当前 HTML；不依赖补丁脚本、片段副本、版本值或浏览器。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const HTML_PATH = path.resolve(process.env.KRAFTED_HTML || path.join(__dirname, '../../kraftpub-dev.html'));
let HTML = '', passed = 0, failed = 0, sections = 0;
function ok(value, label) {
  if (value) passed++;
  else { failed++; console.log('  FAIL: ' + label); }
}
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function eq(actual, expected, label) {
  let same = true;
  try { assert.deepStrictEqual(plain(actual), plain(expected)); } catch (_) { same = false; }
  ok(same, label + (same ? '' : '；实际=' + JSON.stringify(actual) + '，期望=' + JSON.stringify(expected)));
}
function section(label, body) {
  sections++;
  try { body(); } catch (e) { ok(false, label + ' 抛错已记录：' + e.name + ': ' + e.message); }
}
function codeOnly(s) {
  return s.replace(/\/\*[\s\S]{0,4000}?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
}
// 优先列首声明，避免抽到内嵌库中的同名函数。V8 解析完整表达式决定函数终点，
// 不手算括号：正则、模板字符串、嵌套对象、async 均交给真实语法解析器。
function extract(name, source = HTML) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw Error('非法函数名');
  let matches = [...source.matchAll(new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'gm'))];
  if (!matches.length) matches = [...source.matchAll(new RegExp('^[ \\t]+(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'gm'))];
  if (matches.length !== 1) throw Error(name + ' 声明匹配数=' + matches.length);
  const start = matches[0].index, limit = Math.min(source.length, start + 250000);
  for (let end = source.indexOf('}', start); end >= 0 && end < limit; end = source.indexOf('}', end + 1)) {
    const candidate = source.slice(start, end + 1).trimStart();
    try { new vm.Script('(' + candidate + '\n)'); return candidate; } catch (_) { /* 仅继续找语法完整的终点。 */ }
  }
  throw Error(name + ' 没有语法完整的函数边界');
}
function checkScripts(source) {
  let n = 0;
  for (const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1]) || !m[2].trim()) continue;
    if (/\btype\s*=/.test(m[1]) && !/\btype\s*=\s*["']?(?:text\/javascript|application\/javascript|module)/i.test(m[1])) continue;
    new vm.Script(m[2], {filename: HTML_PATH + ':inline-' + (++n)});
  }
  if (!n) throw Error('未发现任何可检查的内联脚本');
  return n;
}

// 严格而有限的 DOM：未知选择器直接报错；父子关系、dataset 字符串、焦点/blur、
// contentEditable 派生状态、innerHTML/textContent、remove/replaceChildren 必须耦合。
function dom() {
  const document = {activeElement: null};
  const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const decode = s => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.parentElement = null; this.children = [];
      this.attributes = {}; this.style = {minWidth: '', whiteSpace: ''}; this.listeners = new Map();
      this.dataset = new Proxy({}, {set(o, k, v) { o[k] = String(v); return true; }});
      this._html = ''; this._editable = 'inherit'; this.className = ''; this.focusCount = 0; this.blurCount = 0;
      this.scrollHeight = 34; this.scrollWidth = 208; this.value = '';
      const values = () => this.className.split(/\s+/).filter(Boolean);
      this.classList = {
        contains: k => values().includes(k),
        add: (...ks) => { this.className = [...new Set(values().concat(ks))].join(' '); },
        remove: (...ks) => { this.className = values().filter(k => !ks.includes(k)).join(' '); },
        toggle: (k, force) => { const on = force === undefined ? !this.classList.contains(k) : !!force; this.classList[on ? 'add' : 'remove'](k); return on; }
      };
    }
    get isConnected() { return this === document.body || !!(this.parentElement && this.parentElement.isConnected); }
    get contentEditable() { return this._editable; }
    set contentEditable(v) { this._editable = String(v); }
    get isContentEditable() { return this._editable === 'true' || (this._editable === 'inherit' && !!this.parentElement?.isContentEditable); }
    get innerHTML() { return this._html + this.children.map(c => '<' + c.tagName.toLowerCase() + '>' + c.innerHTML + '</' + c.tagName.toLowerCase() + '>').join(''); }
    set innerHTML(v) { this.replaceChildren(); this._html = String(v); }
    get textContent() { return decode(this._html) + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.replaceChildren(); this._html = escape(v == null ? '' : v); }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'class') this.className = String(v);
      if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    getAttribute(k) { return Object.hasOwn(this.attributes, k) ? this.attributes[k] : null; }
    appendChild(child) {
      if (!(child instanceof Element)) throw Error('appendChild 需要节点');
      child.remove(); child.parentElement = this; this.children.push(child); return child;
    }
    append(...children) { children.forEach(c => this.appendChild(c)); }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this);
      this.parentElement = null;
    }
    replaceChildren(...children) { this.children.forEach(c => { c.parentElement = null; }); this.children = []; this._html = ''; this.append(...children); }
    contains(node) { return node === this || this.children.some(c => c.contains(node)); }
    matches(selector) {
      const m = selector.match(/^((?:\.[\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
      if (!m || !selector) throw Error('DOM stub 不支持选择器 ' + selector);
      if (m[1] && !m[1].slice(1).split('.').every(c => this.classList.contains(c))) return false;
      if (!m[2]) return true;
      const key = m[2], value = key.startsWith('data-') ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.getAttribute(key);
      return value != null && (m[3] === undefined || value === m[3]);
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      const out = [];
      const visit = el => el.children.forEach(c => { if (c.matches(selector)) out.push(c); visit(c); });
      visit(this); return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { const list = this.listeners.get(type) || []; if (!list.includes(fn)) list.push(fn); this.listeners.set(type, list); }
    dispatchEvent(e) { e.target ||= this; e.currentTarget = this; for (const fn of [...(this.listeners.get(e.type) || [])]) fn.call(this, e); return !e.defaultPrevented; }
    focus() {
      if (document.activeElement === this) return;
      if (!this.isConnected) throw Error('不能聚焦未连接节点');
      document.activeElement?.blur(); document.activeElement = this; this.focusCount++;
      this.dispatchEvent(event('focus'));
    }
    blur() { if (document.activeElement !== this) return; document.activeElement = null; this.blurCount++; this.dispatchEvent(event('blur')); }
  }
  document.body = new Element('body'); document.documentElement = new Element('html');
  document.createElement = tag => new Element(tag);
  document.querySelector = s => document.body.querySelector(s);
  document.querySelectorAll = s => document.body.querySelectorAll(s);
  document.getElementById = id => { const walk = el => el.id === id ? el : el.children.map(walk).find(Boolean); return walk(document.body) || null; };
  return document;
}
function event(type, extra = {}) {
  return Object.assign({type, button: 0, shiftKey: false, metaKey: false, ctrlKey: false, keyCode: 0,
    isComposing: false, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }}, extra);
}
const CORE = ['splitTags','getSelectedItems','selectOnly','clearSelection','toggleSelect','boardTextLabel',
  'selectedBoardTexts','boardTextValue','commonBoardValue','normalizeBoardTextPatch','boardTextPatchPlan',
  'commitBoardTextPlans','applyTextPatch','applyTextStyleToSelected','setTextProp','toggleTextStyle','setTextAlign',
  'applyBoardTextPreset','stepTextSize','boardTagValues','mutateSelectedTags','setItemMeta','submitBoardTags',
  'handleBoardTagKey','libMatches','libraryItems','normalizeBoardTextMeta','serializeBoardText','captureSnapshot',
  'buildManifest','serializeBoard','v4StateToManifest','manifestToV4Restore','boardTextIsComposing',
  'beginBoardTextUndo','finishBoardTextEditing','routeBoardTextMouse','attachTextListeners','getEditingText',
  'addText','autoGrowTextItem','growTextHeightToFit','applyTextProps','updateItemStyle','addTextHandles'];
const sources = new Map();
function sourceOf(name) { if (!sources.has(name)) sources.set(name, extract(name)); return sources.get(name); }
function model(tx) { return plain(Object.fromEntries(Object.entries(tx).filter(([k]) => k !== 'el'))); }
function boot() {
  const document = dom(), calls = {undo: [], save: 0, sync: 0, paper: 0, position: 0, library: 0, refresh: 0, tags: 0, toasts: []}, frames = [];
  const state = {items: [], texts: [], todos: [], mindmaps: [], groups: [], views: [], selected: new Set(), tool: 'select', zoom: .5, pan: {x: 31, y: -17}};
  const textTool = {font:'Arial', size:24, bold:false, italic:false, underline:false, strike:false, highlight:false,
    shadow:false, bg:false, outline:false, uppercase:false, color:'#ffffff', highlightColor:'#ffff00', align:'left'};
  const canvas = document.createElement('div'), canvasContent = document.createElement('div');
  document.body.appendChild(canvas); canvas.appendChild(canvasContent);
  const G = {nextId: 100, nextZ: 7, nextGroupId: 1, nextViewId: 1, nextStrokeId: 1, drawStrokes: []};
  const confirmLog = [];
  const window = {innerWidth: 1280, innerHeight: 800, G, confirm: message => { confirmLog.push(message); return true; }};
  const unexpected = name => () => { throw Error('意外进入非文本依赖：' + name); };
  const context = {document, state, textTool, canvas, canvasContent, G, window, console,
    paperState: {enabled: false, autoFit: true, width: 1920, height: 1080, color:'#112233'},
    KF: {Schema: {createEmptyManifest: () => ({nodes: [], texts: [], groups: []})}},
    CSS: {supports: (key, value) => { if (key !== 'color') throw Error('未知 CSS.supports 属性'); return /^(#[0-9a-f]{3}(?:[0-9a-f]{3})?|red|transparent)$/i.test(value); }},
    _isZhUI: () => false, AUTOSAVE_MEDIA_PREFIX: 'autosave-media:',
    serializeGroup: unexpected('serializeGroup'), serializeView: unexpected('serializeView'),
    getComputedStyle: el => { if (el !== document.documentElement) throw Error('未建模的 computedStyle'); return {getPropertyValue: k => { if (k !== '--canvas-bg') throw Error('未知 CSS 属性'); return '#112233'; }}; },
    requestAnimationFrame: fn => frames.push(fn),
    pushUndo: () => calls.undo.push(JSON.parse(context.captureSnapshot())),
    scheduleAutoSave: () => { calls.save++; }, syncBoardTextUI: () => { calls.sync++; },
    updateAutoFitPaper: () => { calls.paper++; }, positionBoardTextUI: () => { calls.position++; },
    requestLibraryRefresh: () => { calls.library++; }, renderTagControls: () => { calls.tags++; },
    // v7.15.1: mutateSelectedTags now toasts on no-op — record instead of crashing the harness.
    toast: msg => { calls.toasts.push(msg); },
    // v7.15.2: append/replace now bumps the recent-tag store — record instead of crashing.
    bumpRecentTags: tags => { calls.bumps = (calls.bumps || []).concat(tags); },
    refreshSelection: () => { calls.refresh++; }, updateTextColorPalette: () => {},
    setTool: tool => { state.tool = tool; },
    mediaFilterString: unexpected('mediaFilterString'), renderMasks: unexpected('renderMasks'),
    updateCgiOverlays: unexpected('updateCgiOverlays'), _applyAudioItemUiScale: unexpected('audio'), applyImageFraming: unexpected('image'), mmUpdateConnectors: unexpected('mindmap')};
  vm.createContext(context);
  vm.runInContext(CORE.map(sourceOf).join('\n'), context, {timeout: 3000});
  function make(id, props = {}, html = '正文 ' + id) {
    const el = document.createElement('div'); el.className = 'text-item'; el.contentEditable = true; el.innerHTML = html; canvasContent.appendChild(el);
    const tx = Object.assign({id, el, x:37, y:-19, w:287, h:36, z:3, rot:13, opacity:.6, locked:false,
      ...textTool, font:'Georgia', size:21, color:'#123456', name:'', note:'', tags:[], textPreset:''}, props);
    state.texts.push(tx); context.applyTextProps(tx); context.updateItemStyle(tx); return tx;
  }
  return {a:context, state, textTool, document, calls, frames, canvas, canvasContent, make, confirmLog,
    select: (...items) => { state.selected = new Set(items.map(it => it.id)); },
    flush: () => { while (frames.length) frames.shift()(); }};
}

module.exports = {extract, checkScripts};
if (require.main === module) {
section('读取与完整语法', () => { HTML = fs.readFileSync(HTML_PATH, 'utf8'); ok(checkScripts(HTML) >= 1, '全部内联脚本可解析'); });
if (process.argv.includes('--syntax-only')) {
  console.log(`${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
} else {
section('抽取器与 bounded codeOnly 自检', () => {
  const sample = '  function probe(){return 1;}\nfunction probe(){return /}/.test(`x${({a:2}).a}`);}\nasync function delayed(){return await Promise.resolve({a:3});}\nfunction next(){return 4;}';
  eq(vm.runInNewContext('(' + extract('probe', sample) + ')()'), false, '优先真正列首函数并支持正则、模板嵌套');
  ok(extract('delayed', sample).startsWith('async function'), '抽取保留 async');
  ok(!extract('delayed', sample).includes('function next'), '不吞掉相邻函数');
  eq(codeOnly('/* 小注释 */\n// 整行\nreturn 1;').trim(), 'return 1;', '剥离普通块注释与整行注释');
  const bounded = "'/*'" + 'x'.repeat(4100) + '*/ LIVE';
  eq(codeOnly(bounded), bounded, '注释剥离不能跨 4000 字符吞源码');
  for (const name of CORE) ok(sourceOf(name).includes('function ' + name + '('), '从 HTML 抽取 ' + name);
});
section('DOM stub 边界自检', () => {
  const d = dom(), p = d.createElement('div'), c = d.createElement('span'); d.body.appendChild(p); p.appendChild(c);
  p.contentEditable = true; ok(c.isContentEditable && c.isConnected, 'contentEditable 继承且节点连接');
  c.textContent = '<正文>'; eq(c.innerHTML, '&lt;正文&gt;', '纯正文转义'); c.innerHTML = '<b>正文</b>'; eq(c.textContent, '正文', 'HTML 正文同步');
  c.dataset.id = 8; eq(c.dataset.id, '8', 'dataset 字符串化');
  let blur = 0; c.addEventListener('blur', () => blur++); c.focus(); p.focus(); eq(blur, 1, '转移焦点真实触发一次 blur');
  p.replaceChildren(); ok(!c.isConnected && c.parentElement === null, '清空真实解除父子关系');
  let rejected = false; try { p.matches('div > span'); } catch (_) { rejected = true; } ok(rejected, '不支持的 DOM 行为必须报错');
});
section('patch 规范化', () => {
  const {a} = boot();
  eq(a.normalizeBoardTextPatch({size:' 35.5 ', bold:true, italic:false, font:' Georgia ', align:'justify', color:'#abcdef', highlightColor:'red', textPreset:'body', x:999}),
    {size:35.5, bold:true, italic:false, font:'Georgia', align:'justify', color:'#abcdef', highlightColor:'red', textPreset:'body'}, '白名单及有效值');
  for (const input of [null, undefined, [], 'size', 3, {size:'',bold:'false',italic:1,font:' ',align:'bad',color:'invalid',textPreset:'other'}, {size:Infinity}, {size:NaN}])
    eq(a.normalizeBoardTextPatch(input), {}, '非法 patch 不写：' + String(input));
  eq(a.normalizeBoardTextPatch({size:-4}), {size:1}, '字号下限'); eq(a.normalizeBoardTextPatch({size:999}), {size:512}, '字号上限');
  eq(a.normalizeBoardTextPatch(Object.create({size:200,bold:true})), {}, '不读取继承字段');
});
section('计划无副作用与字段隔离', () => {
  const e = boot(), {a, calls} = e, x = e.make(1, {bold:true, align:'right'}), y = e.make(2, {font:'Verdana',size:39}), locked = e.make(3,{locked:true});
  const image = {id:4,el:e.document.createElement('div'),color:'#888888'}; image.el.className='item'; e.state.items.push(image); e.select(x,y,locked,image);
  const before = [model(x),model(y),model(locked)], defaults = plain(e.textTool);
  const plan = a.boardTextPatchPlan({color:'#abcdef'},[x,y,x,locked,image,null]);
  eq(plan.map(p=>p.tx.id),[1,2],'计划去重且排除锁定/非文字/null');
  eq(plan.map(p=>p.patch),[{color:'#abcdef'},{color:'#abcdef'}],'计划只有指定字段');
  eq([model(x),model(y),model(locked)],before,'计划不修改目标'); eq([calls.undo.length,calls.save],[0,0],'计划不提交');
  eq(a.applyTextPatch({color:'#abcdef'}),2,'执行修改两个未锁定文本');
  eq([model(x),model(y),model(locked)],[{...before[0],color:'#abcdef'},{...before[1],color:'#abcdef'},before[2]],'只改颜色，全部其他模型字段不变');
  eq([x.el.style.color,y.el.style.fontSize],['#abcdef','39px'],'真实 applyTextProps 更新 DOM');
  eq([calls.undo.length,calls.save],[1,1],'批量修改只有一次 undo/save');
  eq(calls.undo[0].texts.map(t=>t.color),['#123456','#123456','#123456'],'undo 在字段修改之前');
  eq(e.textTool,defaults,'选中文字不污染新建默认值');
  const count = [calls.undo.length,calls.save,calls.sync,calls.paper];
  for (const patch of [{color:'#abcdef'}, {}, undefined, {size:'NaN'}, {unknown:true}]) eq(a.applyTextPatch(patch),0,'noop 返回零');
  eq(a.applyTextPatch({size:49},[locked]),0,'全锁定返回零');
  eq([calls.undo.length,calls.save,calls.sync,calls.paper],count,'noop/locked 无 undo、保存或重排');
  eq(a.applyTextPatch({size:29},[y,y]),1,'显式目标去重'); eq([x.size,y.size],[21,29],'仅更新指定目标');
  a.applyTextStyleToSelected(); eq([x.font,y.font],['Georgia','Verdana'],'旧无参数入口不能整套覆盖');
});
section('旧属性入口与新建默认值', () => {
  const e=boot(), x=e.make(1,{bold:true}), y=e.make(2,{size:31}); e.select(x,y);
  e.a.setTextProp('font','Verdana'); eq([x.font,y.font,x.size,y.size],['Verdana','Verdana',21,31],'字体入口只改字体');
  e.a.setTextAlign('center'); eq([x.align,y.align,x.size,y.size],['center','center',21,31],'对齐入口只改对齐');
  e.a.toggleTextStyle('bold'); eq([x.bold,y.bold],[true,true],'mixed bold 统一打开'); e.a.toggleTextStyle('bold'); eq([x.bold,y.bold],[false,false],'共同 bold 关闭');
  const u=e.calls.undo.length; e.a.stepTextSize(1); eq([x.size,y.size,e.calls.undo.length],[22,32,u+1],'字号按各自值步进一次 undo');
  e.select(); e.state.tool='text'; const undo=e.calls.undo.length, save=e.calls.save;
  e.a.setTextProp('size',37); eq(e.textTool.size,37,'无选区时修改新建默认字号'); eq([e.calls.undo.length,e.calls.save],[undo,save],'默认值不创建画板事务');
  e.state.tool='select'; e.a.setTextProp('size',40); eq(e.textTool.size,37,'非文本工具不改默认值');
});
for (const [kind,size,bold,bg] of [['title',36,true,false],['body',24,false,false],['label',18,true,true]]) section('预设 '+kind,()=>{
  const e=boot(), x=e.make(1,{italic:true,underline:true,strike:true,highlight:true,shadow:true,outline:true,uppercase:true,align:'right'}), y=e.make(2,{font:'Verdana',color:'#abcdef',w:431}), locked=e.make(3,{locked:true});
  e.select(x,y,locked); const oldLocked=model(locked); x.el.scrollWidth=130; y.el.scrollWidth=600;
  eq(e.a.applyBoardTextPreset(kind),2,kind+' 影响两个未锁定文本');
  for (const tx of [x,y]) {
    eq([tx.size,tx.bold,tx.bg,tx.textPreset],[size,bold,bg,kind],kind+' 核心字段');
    eq([tx.italic,tx.underline,tx.strike,tx.highlight,tx.shadow,tx.outline,tx.uppercase,tx.align],[false,false,false,false,false,false,false,'left'],kind+' 清理冲突效果');
  }
  eq([x.font,y.font,x.color,y.color],['Georgia','Verdana','#123456','#abcdef'],kind+' 保留字体颜色');
  eq([x.w,y.w],kind==='label'?[132,320]:[287,431],kind+' 宽度契约');
  eq(x.el.style.whiteSpace,'',kind+' 恢复 whiteSpace'); eq(model(locked),oldLocked,kind+' 锁定完整保留');
  eq([e.calls.undo.length,e.calls.save],[1,1],kind+' 一个事务');
  eq(e.a.applyBoardTextPreset(kind),0,kind+' 重复 noop'); eq(e.a.applyBoardTextPreset('unknown'),0,'未知预设 noop');
  eq([e.calls.undo.length,e.calls.save],[1,1],kind+' noop 无副作用');
});
section('标签追加、移除、确认、取消及旧 API',()=>{
  const e=boot(), x=e.make(1,{tags:['shared','a']}), y=e.make(2,{tags:['shared','b']}), l=e.make(3,{tags:['keep'],locked:true});
  const image={id:4,tags:['image']}; e.state.items.push(image); e.select(x,y,l,image);
  eq(e.a.boardTagValues(' a, a, b, '),['a','b'],'标签 trim 去重');
  eq(e.a.mutateSelectedTags('append','new, new'),3,'append 文本和媒体');
  eq([x.tags,y.tags,l.tags,image.tags],[['shared','a','new'],['shared','b','new'],['keep'],['image','new']],'append 保留历史与锁定');
  eq([e.calls.undo.length,e.calls.save,e.calls.library],[1,1,1],'标签批量一个事务并刷新 Library');
  e.a.mutateSelectedTags('append','new'); e.a.mutateSelectedTags('remove','missing'); e.a.mutateSelectedTags('bad','new');
  eq(e.calls.undo.length,1,'标签 noop 不记录 undo');
  eq(e.a.mutateSelectedTags('remove',['a']),1,'只移除精确匹配标签'); eq([x.tags,y.tags],[['shared','new'],['shared','b','new']],'remove 不覆盖其他标签');
  const previous=plain([x.tags,y.tags,l.tags,image.tags]), before=[e.calls.undo.length,e.calls.save,e.calls.library];
  let confirmation=0; e.a.window.confirm=message=>{confirmation++; ok(message.includes('Replace all tags'),'替换必须明确询问全部标签'); return false;};
  eq(e.a.mutateSelectedTags('replace','replace'),-1,'取消返回 -1'); eq(confirmation,1,'取消经过确认');
  eq([x.tags,y.tags,l.tags,image.tags],previous,'取消完整保留'); eq([e.calls.undo.length,e.calls.save,e.calls.library],before,'取消无事务');
  e.a.window.confirm=()=>{confirmation++; return true;};
  eq(e.a.mutateSelectedTags('replace','replace'),3,'确认后替换'); eq(confirmation,2,'确认确实被调用');
  eq([x.tags,y.tags,l.tags,image.tags],[['replace'],['replace'],['keep'],['replace']],'replace 精确结果');
  ok(x.tags!==y.tags && x.tags!==image.tags,'替换数组互不共享');
  e.a.setItemMeta('tags','extra'); eq(x.tags,['replace','extra'],'旧 tags API 必须追加而非替换');
  e.a.mutateSelectedTags('replace',[]); eq([x.tags,y.tags,l.tags,image.tags],[[],[],['keep'],[]],'明确确认可清空标签');
});
section('标签输入保留取消草稿及 IME',()=>{
  const e=boot(), x=e.make(1,{tags:['keep']}); e.select(x);
  const root=e.document.createElement('div'), input=e.document.createElement('input'); input.setAttribute('data-tag-input',''); root.appendChild(input);
  input.value='candidate'; e.a.window.confirm=()=>false; e.a.submitBoardTags(root,'replace');
  eq(input.value,'candidate','取消不清草稿'); eq(x.tags,['keep'],'取消不改标签');
  for (const extra of [{isComposing:true},{keyCode:229}]) { const ev=event('keydown',{key:'Enter',...extra}); e.a.handleBoardTagKey(ev,root); eq([ev.defaultPrevented,ev.stopped,e.calls.undo.length],[false,false,0],'IME Enter 透传'); }
  input.dataset.composing='1'; e.a.submitBoardTags(root,'append'); eq(e.calls.undo.length,0,'composition 状态禁止提交'); input.dataset.composing='';
  const ev=event('keydown',{key:'Enter'}); e.a.handleBoardTagKey(ev,root);
  eq([ev.defaultPrevented,ev.stopped,input.value],[true,true,''],'普通 Enter 消费并清草稿'); eq(x.tags,['keep','candidate'],'Enter 真实 append');
  input.value=' '; e.a.submitBoardTags(root,'replace'); eq(x.tags,['keep','candidate'],'空草稿不是清空命令');
});
section('metadata 规范化不得应用预设或变形',()=>{
  const e=boot(), x=e.make(1), before=model(x), data={name:'标题',note:'备注',tags:[' a ',42,'',null,' b '],textPreset:'unknown-future'};
  const r=e.a.normalizeBoardTextMeta(x,data); ok(r===x,'原对象返回');
  eq(model(x),{...before,name:'标题',note:'备注',tags:['a','b'],textPreset:'unknown-future'},'仅更新 metadata，保留未来预设字符串');
  ok(x.tags!==data.tags,'metadata 标签独立'); data.tags[0]='changed'; eq(x.tags,['a','b'],'外部更改不回流');
  e.a.normalizeBoardTextMeta(x,{tags:' one, two, ',name:2,note:{},textPreset:4});
  eq([x.name,x.note,x.tags,x.textPreset],['','',['one','two'],''],'旧字符串标签与非法 metadata 默认值');
  e.a.normalizeBoardTextMeta(x,null); eq([x.name,x.note,x.tags,x.textPreset],['','',[],''],'缺失 metadata 安全默认');
  eq([x.w,x.h,x.font,x.size,x.color],[287,36,'Georgia',21,'#123456'],'规范化不更改几何样式'); eq([e.calls.undo.length,e.calls.save],[0,0],'读取 metadata 无副作用');
});
section('序列化实时 DOM、无 DOM 和独立标签',()=>{
  const e=boot(), x=e.make(1,{name:'标题',note:'备注',tags:['alpha','beta'],textPreset:'label',userResized:true,_autoGrowLocked:true,_textZoom:9,html:'过时 HTML',content:'过时正文'},'<b>现场正文</b>');
  const out=e.a.serializeBoardText(x);
  eq([out.html,out.content],['<b>现场正文</b>','现场正文'],'优先序列化实时 DOM');
  eq([out.name,out.note,out.tags,out.textPreset],['标题','备注',['alpha','beta'],'label'],'metadata 不丢失');
  for (const key of ['id','x','y','w','h','z','rot','opacity','locked','font','size','bold','italic','color','align','userResized','_autoGrowLocked']) eq(out[key],x[key],'序列化保留 '+key);
  eq(out._textZoom,1,'世界坐标标记归一'); ok(out.tags!==x.tags,'序列化标签独立'); ok(!Object.hasOwn(out,'el'),'序列化不带 DOM');
  const noDOM={...model(x),html:'<i>存储正文</i>',content:'存储正文'};
  const stored=e.a.serializeBoardText(noDOM); eq([stored.html,stored.content],['<i>存储正文</i>','存储正文'],'无 DOM 保留已有 HTML/正文');
  const plainOnly=e.a.serializeBoardText({content:'<literal>'}); eq([plainOnly.html,plainOnly.content],['','<literal>'],'纯正文不升级为 HTML');
});
for (const name of ['captureSnapshot','buildManifest','serializeBoard']) section('真实序列化调用点 '+name,()=>{
  const code=codeOnly(sourceOf(name));
  const needle=name==='serializeBoard'?'return serializeBoardText(t);':'texts: state.texts.map(serializeBoardText)';
  eq(code.split(needle).length-1,1,name+' 精确 pin 共享序列化 callsite');
  const e=boot(), x=e.make(1,{name:'名字',note:'笔记',tags:['one','two'],textPreset:'title'},'<b>实时内容</b>');
  const raw=e.a[name](), out=typeof raw==='string'?JSON.parse(raw):raw;
  eq(out.texts.length,1,name+' 实际返回一条文字');
  eq([out.texts[0].html,out.texts[0].content,out.texts[0].name,out.texts[0].note,out.texts[0].tags,out.texts[0].textPreset],['<b>实时内容</b>','实时内容','名字','笔记',['one','two'],'title'],name+' 真实执行保留正文与 metadata');
  x.tags.push('later'); eq(out.texts[0].tags,['one','two'],name+' 标签不与 live state 共享');
});
section('legacy bridge 双向实际执行',()=>{
  const e=boot(), x=e.make(1,{name:'旧桥',note:'说明',tags:['a','b'],textPreset:'body',_autoGrowLocked:true},'<i>旧正文</i>');
  const manifest=e.a.v4StateToManifest(), restored=e.a.manifestToV4Restore(manifest);
  for (const out of [manifest.texts[0],restored.texts[0]]) {
    eq([out.html,out.content,out.name,out.note,out.tags,out.textPreset],['<i>旧正文</i>','旧正文','旧桥','说明',['a','b'],'body'],'legacy 保留正文 metadata');
    eq([out.x,out.y,out.w,out.h,out.size,out.rot,out.opacity],[37,-19,287,36,21,13,.6],'legacy 不改变几何样式');
  }
  ok(manifest.texts[0].tags!==x.tags && restored.texts[0].tags!==manifest.texts[0].tags,'legacy 双向标签独立');
  const old=e.a.manifestToV4Restore({texts:[{id:8,w:111,h:22,size:18,content:'纯正文',tags:' a, b '}]});
  eq([old.texts[0].name,old.texts[0].note,old.texts[0].tags,old.texts[0].textPreset,old.texts[0].html,old.texts[0].content],['','',['a','b'],'','','纯正文'],'旧数据默认 metadata 与字符串标签');
});
section('Library 正文搜索与类型边界',()=>{
  const e=boot(), x=e.make(1,{name:'Name',note:'Remark',tags:['Tag']},'<b>Unique Search Body</b>');
  for (const query of ['search BODY','name','remark','tag','']) ok(e.a.libMatches(x,query),'Library 命中 '+query);
  ok(!e.a.libMatches(x,'never-present'),'Library 不误命中');
  const old={id:2,content:'Detached Legacy Body'}; e.state.texts.push(old); ok(e.a.libMatches(old,'legacy BODY'),'无 DOM 文本搜索存储正文');
  const image={id:3,content:'not searchable media body',el:e.document.createElement('div')}; image.el.textContent='not searchable media body'; e.state.items.push(image);
  ok(!e.a.libMatches(image,'media body'),'媒体 DOM 不当作文本正文');
  eq(e.a.libraryItems().map(it=>it.id),[3,1,2],'Library 索引含媒体和文本');
});
section('正文鼠标保留原生光标且绝不启动移动',()=>{
  const e=boot(), x=e.make(1), y=e.make(2); e.a.attachTextListeners(x); e.select(y); const before=model(x);
  const child=e.document.createElement('span'); child.textContent='嵌套正文'; x.el.appendChild(child);
  const ev=event('mousedown',{target:child}); eq(e.a.routeBoardTextMouse(ev),true,'正文路由已处理');
  eq([ev.defaultPrevented,ev.stopped],[false,false],'正文不 preventDefault/stopPropagation');
  eq([...e.state.selected],[1],'正文单选当前文本'); ok(e.document.activeElement===x.el,'正文聚焦实际文本');
  eq(model(x),before,'正文不修改坐标/宽高或样式'); eq(e.calls.undo.length,0,'正文点击没有移动 undo');
  ok(!e.state.dragging && !e.state.dragStart && !e.state.resizing,'正文未启动移动/缩放状态');
  const focus=x.el.focusCount; e.a.routeBoardTextMouse(event('mousedown',{target:child})); eq(x.el.focusCount,focus,'重复正文点击不重启编辑');
});
for (const modifier of ['shiftKey','metaKey','ctrlKey']) section('修饰键选择 '+modifier,()=>{
  const e=boot(), x=e.make(1), y=e.make(2); e.select(y); const ev=event('mousedown',{target:x.el,[modifier]:true});
  eq(e.a.routeBoardTextMouse(ev),true,'修饰键走选择路由'); eq([...e.state.selected],[2,1],'追加选择不丢其他项目');
  eq([ev.defaultPrevented,x.el.focusCount],[true,0],'选择模式阻止光标但不编辑');
  e.a.routeBoardTextMouse(event('mousedown',{target:x.el,[modifier]:true})); eq([...e.state.selected],[2],'再次切换移除');
});
section('锁定正文与边框选择',()=>{
  const e=boot(), x=e.make(1,{locked:true}); const before=model(x), ev=event('mousedown',{target:x.el});
  eq(e.a.routeBoardTextMouse(ev),true,'锁定仍可选择'); eq([ev.defaultPrevented,x.el.focusCount],[true,0],'锁定不能编辑'); eq(model(x),before,'锁定模型不动');
  x.locked=false; e.a.addTextHandles(x); const edge=e.canvasContent.querySelector('.bt-select-edge'); const edgeEv=event('mousedown',{target:edge});
  eq(e.a.routeBoardTextMouse(edgeEv),true,'兄弟边框解析 owner'); eq([...e.state.selected],[1],'边框选中正确文本'); eq(edgeEv.defaultPrevented,true,'边框不是正文编辑');
});
for (const selector of ['.bt-move','.item-handle[data-text-handle]']) section('把手交还 existing '+selector,()=>{
  const e=boot(), x=e.make(1); e.a.attachTextListeners(x); e.a.addTextHandles(x); x.el.focus(); e.state.tool='text';
  const before=model(x), ev=event('mousedown',{target:e.canvasContent.querySelector(selector)});
  eq(e.a.routeBoardTextMouse(ev),false,'返回 false 交还既有移动/缩放路由'); eq([ev.defaultPrevented,ev.stopped],[false,false],'不提前消费把手事件');
  eq([x.el.blurCount,e.state.tool],[1,'select'],'结束正文编辑并切回选择工具'); eq(model(x),before,'路由本身不修改坐标/尺寸');
});
section('非文本与其他工具透传',()=>{
  const e=boot(), x=e.make(1);
  for (const [tool,button,target] of [['select',1,x.el],['draw',0,x.el],['select',0,e.canvas]]) {
    e.state.tool=tool; const ev=event('mousedown',{button,target}); eq(e.a.routeBoardTextMouse(ev),false,'无关鼠标透传'); eq([ev.defaultPrevented,ev.stopped],[false,false],'无关事件不消费');
  }
});
section('IME 三种信号',()=>{
  const e=boot(), el=e.make(1).el;
  eq(e.a.boardTextIsComposing({},el),false,'普通事件不是 IME');
  eq(e.a.boardTextIsComposing({isComposing:true},el),true,'isComposing');
  eq(e.a.boardTextIsComposing({keyCode:229},el),true,'keyCode 229');
  el._btComposing=true; eq(e.a.boardTextIsComposing({},el),true,'元素 composition 标志');
  eq(e.a.boardTextIsComposing({},null),false,'无元素安全');
});
section('beforeinput 一次 undo 与 Esc 保留编辑',()=>{
  const e=boot(), x=e.make(1,{},'<b>修改前</b>'); e.a.attachTextListeners(x); e.a.attachTextListeners(x);
  eq(x.el.listeners.get('beforeinput').length,1,'重复 attach 不重复监听');
  eq([x.el.getAttribute('role'),x.el.getAttribute('aria-multiline')],['textbox','true'],'编辑语义属性');
  x.el.focus(); eq(e.calls.undo.length,0,'仅聚焦不推 undo');
  const first=event('beforeinput'); x.el.dispatchEvent(first); eq(first.defaultPrevented,false,'未锁定输入可进行');
  x.el.innerHTML='<i>修改后</i>'; x.el.dispatchEvent(event('input')); x.el.dispatchEvent(event('beforeinput'));
  eq(e.calls.undo.length,1,'同次编辑 beforeinput 只推一次 undo'); eq(e.calls.undo[0].texts[0].html,'<b>修改前</b>','undo 捕获修改前正文');
  e.state.tool='text'; const ev=event('keydown',{key:'Escape'}); x.el.dispatchEvent(ev);
  eq([x.el.innerHTML,ev.defaultPrevented,ev.stopped],['<i>修改后</i>',true,true],'Esc 提交且保留正文，消费事件');
  eq([e.document.activeElement,e.state.tool,e.state.selected.size],[null,'select',0],'Esc 结束编辑/工具/选择');
  eq(e.calls.undo.length,1,'Esc/blur 不重复推 undo');
  x.el.focus(); x.el.dispatchEvent(event('beforeinput')); eq(e.calls.undo.length,2,'下次 focus 开始新的 undo 生命周期');
});
for (const extra of [{isComposing:true},{keyCode:229},{elementComposition:true}]) section('IME Escape 透传 '+JSON.stringify(extra),()=>{
  const e=boot(), x=e.make(1); e.a.attachTextListeners(x); x.el.focus();
  if (extra.elementComposition) x.el.dispatchEvent(event('compositionstart'));
  const ev=event('keydown',{key:'Escape',...extra}); x.el.dispatchEvent(ev);
  eq([ev.defaultPrevented,ev.stopped,x.el.blurCount],[false,false,0],'IME 不被 Escape 结束或消费');
  if (extra.elementComposition) { e.a.finishBoardTextEditing(); ok(e.document.activeElement===x.el,'Done 在 composition 中也保留焦点'); x.el.dispatchEvent(event('compositionend')); eq(x.el._btComposing,false,'compositionend 清标记'); }
});
section('锁定输入、快捷提交及空文本删除',()=>{
  const e=boot(), x=e.make(1,{locked:true}); e.a.attachTextListeners(x);
  const before=event('beforeinput'); x.el.dispatchEvent(before); eq([before.defaultPrevented,e.calls.undo.length],[true,0],'锁定 beforeinput 拒绝且不 undo');
  e.a.beginBoardTextUndo(x); eq(e.calls.undo.length,0,'直接 undo 入口同样保护锁定');
  x.locked=false; x.el.focus(); const enter=event('keydown',{key:'Enter'}); x.el.dispatchEvent(enter); eq([enter.defaultPrevented,x.el.blurCount],[false,0],'普通 Enter 留给换行');
  const submit=event('keydown',{key:'Enter',ctrlKey:true}); x.el.dispatchEvent(submit); eq([submit.defaultPrevented,submit.stopped,x.el.blurCount],[true,true,1],'Ctrl Enter 结束编辑');
  x.el.focus(); e.a.addTextHandles(x); x.el.dispatchEvent(event('beforeinput')); x.el.textContent=''; x.el.blur();
  eq(e.state.texts.length,0,'空正文 blur 移除模型'); ok(!x.el.isConnected,'空正文真实 detach'); eq(e.canvasContent.querySelector('.text-handles'),null,'空正文移除兄弟把手');
  eq(e.calls.undo.length,1,'删除沿用 beforeinput 快照');
});
section('新建宽 320、输入只改高及旧自动宽标记',()=>{
  const e=boot(); e.state.tool='text'; const x=e.a.addText(43,59,'正文'); e.flush();
  eq([x.x,x.y,x.w,x.h,x.size,x.textPreset],[43,59,320,36,24,'body'],'新建世界坐标及宽度默认值');
  eq([x.name,x.note,x.tags],['','',[]],'新建 metadata 默认值'); eq(e.calls.undo.length,1,'新建一次 undo');
  const before=model(x); x.el.scrollHeight=117.2; x.el.scrollWidth=1700; x.el.dispatchEvent(event('beforeinput')); x.el.textContent='很长的新正文'; x.el.dispatchEvent(event('input'));
  eq(model(x),{...before,h:120},'输入仅改变高度，宽度/字号/坐标不变'); eq([x.el.style.width,x.el.style.height],['320px','120px'],'真实样式应用固定宽度和测量高度');
  x._autoGrowLocked=false; x.userResized=false; x.el.scrollHeight=15; x.el.style.minWidth='12px'; e.a.autoGrowTextItem(x);
  eq([x.w,x.h,x.size,x.el.style.minWidth],[320,32,24,'12px'],'旧 autoWidth 标记不能恢复自动宽；高度最小 32');
  const y=e.a.addText(0,0,'指定宽度',{initW:457,noFocus:true}); e.flush(); eq(y.w,457,'显式 initW 保留'); eq(y.el.focusCount,0,'noFocus 不抢焦点');
  const detached=e.make(9); detached.el.remove(); const old=model(detached); e.a.autoGrowTextItem(detached); eq(model(detached),old,'未连接 DOM 不测量');
});
section('仅左右两个尺寸柄且始终为兄弟节点',()=>{
  const e=boot(), x=e.make(1); e.a.addTextHandles(x); let box=e.canvasContent.querySelector('.text-handles');
  ok(box && box.parentElement===x.el.parentElement && !x.el.contains(box),'把手不污染 contenteditable 正文');
  eq(box.querySelectorAll('.item-handle').map(h=>[h.dataset.dir,h.dataset.id,h.dataset.textHandle]),[['e','1','1'],['w','1','1']],'仅 e/w 两个尺寸柄');
  eq(box.querySelectorAll('.bt-select-edge').map(h=>h.className),['bt-select-edge n','bt-select-edge s'],'上下是选择边框而非尺寸柄');
  eq(box.querySelectorAll('.bt-move').length,1,'一个移动把手');
  eq([box.style.left,box.style.top,box.style.width,box.style.height],['37px','-19px','287px','36px'],'兄弟把手使用真实几何');
  const old=box.children.slice(); e.a.addTextHandles(x); eq(e.canvasContent.querySelectorAll('.text-handles').length,1,'重复刷新不累加容器'); ok(old.every(h=>h.parentElement===null),'刷新移除旧孩子');
  e.a.addTextHandles(x,true); eq([box.querySelectorAll('.bt-move').length,box.querySelectorAll('.item-handle').length,box.querySelectorAll('.bt-select-edge').length],[1,0,0],'moveOnly 只建移动把手');
  box.remove(); x.locked=true; e.a.addTextHandles(x); eq(e.canvasContent.querySelector('.text-handles'),null,'锁定不创建可操作把手');
});
section('受测函数反面约束及鼠标入口 pin',()=>{
  const editing=codeOnly(sourceOf('attachTextListeners'));
  ok(!/\.innerHTML\s*=\s*[^;\n]*_focusSnapshot/.test(editing),'旧 Escape 恢复 focusSnapshot 的写回不存在');
  const patchCode=codeOnly(['applyTextStyleToSelected','applyTextPatch','commitBoardTextPlans','setTextProp'].map(sourceOf).join('\n'));
  ok(!/Object\.assign\([^;\n]*textTool|\.\.\.textTool|(?:tx|plan\.tx)\s*\[?[^;\n]*=\s*textTool/.test(patchCode),'受测 patch 路径禁止整套 textTool 赋值');
  const growth=codeOnly(['autoGrowTextItem','growTextHeightToFit'].map(sourceOf).join('\n'));
  ok(!/\btx\.w\s*=|\b(?:scrollWidth|measureText|autoFitTextItem)\b/.test(growth),'输入增长函数无自动宽度逻辑');
  const routing=codeOnly(sourceOf('routeBoardTextMouse'));
  ok(!/\b(?:tx\.[xy]|state\.(?:dragging|dragStart|resizing))\s*=/.test(routing),'正文路由没有移动状态赋值');
  // 锁定既有 mousedown 的前置路由，而不是靠孤立函数存在宣称接线正常。
  const routed=HTML.indexOf('if (routeBoardTextMouse(e)) return;');
  ok(routed>=0,'既有鼠标入口实际调用文本路由');
});
console.log(`\n${passed} passed, ${failed} failed; ${sections} sections`);
if (!failed) console.log('ALL PASS');
process.exitCode = failed ? 1 : 0;
}
}
