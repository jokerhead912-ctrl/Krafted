#!/bin/zsh
# 只变异临时副本；复用测试的语法抽取器与 mutlib.sh 判定器。
# 每个函数内 old 必须精确一次，函数全文也必须精确一次；拒绝空替换和非法 JS。
# 正常基线必须不能被捉到；每个 catch 必须有 exit=1、FAIL 行和非零 summary。
if [ -z "${ZSH_VERSION:-}" ]; then exec /bin/zsh "$0" "$@"; fi
set -u
HERE=${0:A:h}
SOURCE=${KRAFTED_HTML:-${HERE:h:h}/kraftpub-dev.html}
TEST="$HERE/test_v7_15_0.js"
NODE=${NODE:-$(command -v node)}
TMP=$(mktemp -d "${TMPDIR:-/tmp}/krafted-v7150.XXXXXX") || exit 1
trap 'rm -f "$TMP/base.html" "$TMP/mut.html"; rmdir "$TMP"' EXIT
cp "$SOURCE" "$TMP/base.html" || exit 1
. "$HERE/mutlib.sh"
NOTCAUGHT=0 CAUGHT=0 FRAGILE=0 SKIPPED=0 ILLEGAL=0 TOTAL=0

run() {
  local out rc
  out=$(KRAFTED_HTML="$TMP/mut.html" "$NODE" "$TEST" 2>&1); rc=$?
  judge "$1" "$out"
  # mutlib 的 summary 判定以外，再要求明确 FAIL、结束计数和正常失败退出。
  if [[ "$JUDGED" == caught ]]; then
    "$NODE" -e 'const o=process.argv[1];process.exit(process.argv[2]==="1" && /^  FAIL: /m.test(o) && /\b[1-9][0-9]* failed; [1-9][0-9]* sections/m.test(o) ? 0 : 1)' "$out" "$rc"
    if [[ $? -ne 0 ]]; then JUDGED=unproven; print '  UNPROVEN：缺少 FAIL + summary + exit=1 的完整证据'; fi
  fi
  tally_judged
  if [[ "$JUDGED" != caught ]]; then print -r -- "$out"; fi
}
mutate() { # 标签、函数名、旧代码、新代码；没有全局模糊替换。
  TOTAL=$((TOTAL + 1))
  "$NODE" - "$TEST" "$TMP/base.html" "$TMP/mut.html" "$2" "$3" "$4" <<'NODE'
const fs=require('fs');
const [test,input,output,name,old,replacement]=process.argv.slice(2);
const {extract,checkScripts}=require(test);
const source=fs.readFileSync(input,'utf8');
let body;
try { body=extract(name,source); } catch(e) { console.log('ANCHOR MISS: '+e.message); process.exit(2); }
const count=(s,n)=>s.split(n).length-1;
if (!old || old===replacement || count(body,old)!==1 || count(source,body)!==1) {
  console.log('ANCHOR MISS: '+name+' old='+count(body,old)+' function='+count(source,body)); process.exit(2);
}
const mutated=source.replace(body,body.replace(old,replacement));
try { checkScripts(mutated); extract(name,mutated); }
catch(e) { console.log('ILLEGAL MUTATION: '+e.message); process.exit(3); }
fs.writeFileSync(output,mutated);
NODE
  local rc=$?
  if [[ $rc -eq 2 ]]; then SKIPPED=$((SKIPPED + 1)); print "  SKIPPED (exact-anchor) <- $1"; return; fi
  if [[ $rc -ne 0 ]]; then ILLEGAL=$((ILLEGAL + 1)); NOTCAUGHT=$((NOTCAUGHT + 1)); print "  ILLEGAL/UNPROVEN <- $1"; return; fi
  run "$1"
}

print '文本变异测试：先验证原始基线不能被误判为 caught'
base=$(KRAFTED_HTML="$TMP/base.html" "$NODE" "$TEST" 2>&1); base_rc=$?
judge '未变异基线 negative control' "$base"
"$NODE" -e 'const o=process.argv[1];process.exit(process.argv[2]==="0" && /[1-9][0-9]* passed, 0 failed; [1-9][0-9]* sections/.test(o) && /^ALL PASS$/m.test(o) && !/^  FAIL:/m.test(o) ? 0 : 1)' "$base" "$base_rc"
if [[ $? -ne 0 || "$JUDGED" != notcaught ]]; then
  print -r -- "$base"
  print 'MUTVERDICT BAD holes=1 skipped=0 caught=0 fragile=0 baseline=failed'
  exit 1
fi
print '基线通过；以下每项均为独立、可解析的源码变异'

mutate '字号上限失效' normalizeBoardTextPatch \
  'Math.max(1, Math.min(512, Number(value)))' 'Math.max(1, Math.min(1024, Number(value)))'
mutate '字号下限失效' normalizeBoardTextPatch \
  'Math.max(1, Math.min(512, Number(value)))' 'Math.max(0, Math.min(512, Number(value)))'
mutate '字符串布尔值被错误接受' normalizeBoardTextPatch \
  "if (typeof value === 'boolean') clean[key] = value;" 'clean[key] = !!value;'
mutate '颜色白名单失效' normalizeBoardTextPatch \
  "CSS.supports('color', value)" 'true'
mutate '计划不保护锁定文本' boardTextPatchPlan \
  '!tx.locked && keys.some' 'keys.some'
mutate '计划把未改变的项目也提交' boardTextPatchPlan \
  'boardTextValue(tx, key) !== clean[key]' 'true'
mutate '目标列表不去重' selectedBoardTexts \
  'Array.from(new Set(targets === undefined ? getSelectedItems() : targets))' 'Array.from(targets === undefined ? getSelectedItems() : targets)'
mutate '目标列表混入媒体' selectedBoardTexts \
  "tx && tx.el && tx.el.classList.contains('text-item')" 'tx && tx.el'
mutate 'applyTextPatch 丢失显式目标' applyTextPatch \
  'boardTextPatchPlan(patch, targets)' 'boardTextPatchPlan(patch)'
mutate '空计划仍推 undo 和保存' commitBoardTextPlans \
  'if (!plans.length) return 0;' 'if (false) return 0;'
mutate '样式修改没有 undo' commitBoardTextPlans \
  'pushUndo();' 'void 0;'
mutate '样式修改没有 autosave' commitBoardTextPlans \
  'scheduleAutoSave();' 'void 0;'
mutate '整套默认样式覆盖选择项目的旧回归' commitBoardTextPlans \
  'applyTextProps(plan.tx);' 'Object.assign(plan.tx, textTool); applyTextProps(plan.tx);'
mutate '字段写入没有反映到真实 DOM' commitBoardTextPlans \
  'applyTextProps(plan.tx);' 'void 0;'
mutate '无 patch 旧入口隐式应用整套默认' applyTextStyleToSelected \
  'return applyTextPatch(patch);' 'return applyTextPatch(patch || textTool);'
mutate '无选区默认值写入污染其他工具' setTextProp \
  "if (state.tool === 'text') Object.keys(patch)" 'if (true) Object.keys(patch)'
mutate '标题预设错误字号' applyBoardTextPreset \
  'title:{size:36, bold:true, bg:false}' 'title:{size:24, bold:true, bg:false}'
mutate '正文预设没有清除斜体' applyBoardTextPreset \
  'italic:false, underline:false' 'italic:true, underline:false'
mutate '标签预设忘记背景' applyBoardTextPreset \
  'label:{size:18, bold:true, bg:true}' 'label:{size:18, bold:true, bg:false}'
mutate '预设 metadata 丢失' applyBoardTextPreset \
  'textPreset:kind' "textPreset:''"
mutate '标签预设误用旧宽而非内容宽' commitBoardTextPlans \
  'Math.max(100, Math.min(320, Math.ceil(el.scrollWidth) + 2))' 'plan.tx.w'

mutate '标签 append 变成覆盖' mutateSelectedTags \
  'boardTagValues(previous.concat(tags))' 'boardTagValues(tags)'
mutate '标签 remove 方向反转' mutateSelectedTags \
  'tags.indexOf(tag) < 0' 'tags.indexOf(tag) >= 0'
mutate '标签锁定保护失效' mutateSelectedTags \
  'if (it.locked) return;' 'if (false) return;'
mutate '标签 replace 取消仍被提交' mutateSelectedTags \
  "if (mode === 'replace' && !window.confirm" "if (false && mode === 'replace' && !window.confirm"
mutate '标签 replace 确认结果反转' mutateSelectedTags \
  "if (mode === 'replace' && !window.confirm" "if (mode === 'replace' && window.confirm"
mutate '标签 replace 共享数组' mutateSelectedTags \
  'else next = tags.slice();' 'else next = tags;'
mutate '旧 tags API 错误替换而非追加' setItemMeta \
  "mutateSelectedTags('append', value)" "mutateSelectedTags('replace', value)"
mutate '取消替换错误清空草稿' submitBoardTags \
  "if (changed >= 0) input.value = '';" "input.value = '';"
mutate '标签 IME Enter 被误提交' handleBoardTagKey \
  ' || event.isComposing || event.keyCode === 229' ''
mutate '标签重复操作仍产生事务' mutateSelectedTags \
  'if (!plans.length) {' 'if (false) {'

mutate 'metadata 缺失默认名称失效' normalizeBoardTextMeta \
  "tx.name = typeof data.name === 'string' ? data.name : '';" 'tx.name = data.name;'
mutate 'metadata 标签不 trim' normalizeBoardTextMeta \
  'return tag.trim();' 'return tag;'
mutate 'metadata 错误应用预设并改变字号' normalizeBoardTextMeta \
  'return tx;' 'tx.size = 36; return tx;'
mutate '序列化保存过时 HTML 而非实时正文' serializeBoardText \
  "html: t.el ? t.el.innerHTML : (typeof t.html === 'string' ? t.html : '')," "html: typeof t.html === 'string' ? t.html : '',"
mutate '序列化丢失纯正文' serializeBoardText \
  "content: t.el ? t.el.textContent : (typeof t.content === 'string' ? t.content : '')," "content: '',"
mutate '序列化丢失 metadata 来源' serializeBoardText \
  '}, t);' '}, {});'
mutate 'undo 序列化 callsite 被绕过' captureSnapshot \
  'texts: state.texts.map(serializeBoardText)' 'texts: state.texts.map(t => ({id:t.id}))'
mutate 'manifest 序列化 callsite 被绕过' buildManifest \
  'texts: state.texts.map(serializeBoardText)' 'texts: state.texts.map(t => ({id:t.id}))'
mutate 'autosave 序列化 callsite 被绕过' serializeBoard \
  'return serializeBoardText(t);' 'return {id:t.id};'
mutate 'legacy 正向桥丢失 textPreset' v4StateToManifest \
  "textPreset: t.textPreset || ''" "textPreset: ''"
mutate 'legacy 逆向桥丢失标签' manifestToV4Restore \
  'tags: Array.isArray(t.tags) ? t.tags.slice() : splitTags(t.tags)' 'tags: []'
mutate 'Library 不再搜索正文' libMatches \
  "var body = isText ? (it.el ? it.el.textContent : (it.content || '')) : '';" "var body = '';"
mutate 'Library 文本搜索大小写敏感' libMatches \
  'String(q).toLowerCase()' 'String(q)'
mutate 'Library 索引漏掉文字' libraryItems \
  'return (state.items || []).concat(state.texts || []);' 'return (state.items || []);'

mutate '正文鼠标阻止原生光标' routeBoardTextMouse \
  'tx.el.focus({preventScroll:true});' 'e.preventDefault(); tx.el.focus({preventScroll:true});'
mutate '正文鼠标错误开始拖动' routeBoardTextMouse \
  'tx.el.focus({preventScroll:true});' 'state.dragging = true; tx.x += 10; tx.el.focus({preventScroll:true});'
mutate 'Shift 选择覆盖其他项目' routeBoardTextMouse \
  'toggleSelect(tx.id);' 'selectOnly(tx.id);'
mutate '锁定正文可以进入编辑' routeBoardTextMouse \
  'tx.locked || edge || e.shiftKey' 'edge || e.shiftKey'
mutate 'grip 抢占既有移动缩放生命周期' routeBoardTextMouse \
  'return false; // existing move/resize lifecycle owns the gesture' 'return true; // existing move/resize lifecycle owns the gesture'
mutate 'grip 不结束正文编辑' routeBoardTextMouse \
  'if (editing) editing.el.blur();' 'void 0;'
mutate '非左键也进入正文编辑' routeBoardTextMouse \
  "e.button !== 0 || (state.tool !== 'select' && state.tool !== 'text')" "(state.tool !== 'select' && state.tool !== 'text')"
mutate 'IME isComposing 信号丢失' boardTextIsComposing \
  'e.isComposing || ' ''
mutate 'IME 229 信号丢失' boardTextIsComposing \
  'e.keyCode === 229 || ' ''
mutate 'IME 元素状态信号丢失' boardTextIsComposing \
  '(el && el._btComposing)' 'false'
mutate '旧 Escape 还原正文回归' attachTextListeners \
  'finishBoardTextEditing();' 'el.innerHTML = el._focusSnapshot; finishBoardTextEditing();'
mutate 'beforeinput 没有创建 undo' attachTextListeners \
  'beginBoardTextUndo(tx);' 'void 0;'
mutate 'beforeinput 重复产生 undo' beginBoardTextUndo \
  'tx.locked || tx.el._btUndo' 'tx.locked'
mutate 'beforeinput 不再拦截锁定输入' attachTextListeners \
  'if (tx.locked) { e.preventDefault(); return; }' 'if (false) { e.preventDefault(); return; }'
mutate 'focus 错误提前生成 undo' attachTextListeners \
  'el._focusSnapshot = el.innerHTML;' 'pushUndo(); el._focusSnapshot = el.innerHTML;'
mutate 'Esc 没有阻止冒泡到全局快捷键' attachTextListeners \
  'ke.stopPropagation();' 'void 0;'
mutate '新文本错误初始宽度' addText \
  'opts.initW : 320, h: 36' 'opts.initW : 220, h: 36'
mutate '自动宽度旧逻辑回归' autoGrowTextItem \
  'growTextHeightToFit(tx);' 'tx.w = Math.ceil(tx.el.scrollWidth) + 2; growTextHeightToFit(tx);'
mutate 'input 不再测量高度' attachTextListeners \
  "el.addEventListener('input', () => {
    autoGrowTextItem(tx);" "el.addEventListener('input', () => {
    void 0;"
mutate '高度错误缩放字号' growTextHeightToFit \
  'tx.h = nextH;' 'tx.h = nextH; tx.size *= 2;'
mutate '高度最小值失效' growTextHeightToFit \
  'Math.max(32, Math.ceil(el.scrollHeight) + 2)' 'Math.max(1, Math.ceil(el.scrollHeight) + 2)'
mutate '恢复八个缩放柄旧逻辑' addTextHandles \
  "['e','w'].forEach(dir => {" "['n','s','e','w','ne','nw','se','sw'].forEach(dir => {"
mutate '把手污染 contenteditable 正文' addTextHandles \
  'tx.el.parentElement.appendChild(box);' 'tx.el.appendChild(box);'
mutate '锁定文本仍生成把手' addTextHandles \
  '!tx.el || !tx.el.parentElement || tx.locked' '!tx.el || !tx.el.parentElement'

if ! cmp -s "$SOURCE" "$TMP/base.html"; then
  print 'SOURCE CHANGED：主代理已更新 HTML，需要重跑本套测试与锚点。'
  NOTCAUGHT=$((NOTCAUGHT + 1))
fi
if [[ $TOTAL -lt 15 ]]; then NOTCAUGHT=$((NOTCAUGHT + 1)); fi
if [[ $NOTCAUGHT -eq 0 && $SKIPPED -eq 0 && $FRAGILE -eq 0 && $ILLEGAL -eq 0 && $CAUGHT -eq $TOTAL ]]; then
  print "MUTVERDICT ok holes=0 skipped=0 caught=$CAUGHT total=$TOTAL fragile=0 illegal=0"
  exit 0
fi
print "MUTVERDICT BAD holes=$NOTCAUGHT skipped=$SKIPPED caught=$CAUGHT total=$TOTAL fragile=$FRAGILE illegal=$ILLEGAL"
exit 1
