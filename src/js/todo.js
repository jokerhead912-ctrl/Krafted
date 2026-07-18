
import { state, G, canvasContent } from './core-state.js';
import { scheduleAutoSave } from './save-load.js';
import { pushUndo } from './undo-redo.js';
import { selectOnly, toggleSelect } from './selection.js';
import { updateItemStyle } from './add-items.js';

// ============================================================
//  TO-DO LIST ITEMS
// ============================================================
export function addTodo(x, y) {
  pushUndo();
  const el = document.createElement('div');
  el.className = 'todo-item';
  canvasContent.appendChild(el);
  const todo = {
    id: G.nextId++, el,
    x: x !== undefined ? x : (window.innerWidth/2 - 120 - state.pan.x) / state.zoom,
    y: y !== undefined ? y : (window.innerHeight/2 - 80 - state.pan.y) / state.zoom,
    w: 260, h: 120, z: G.nextZ++, rot: 0, opacity: 1,
    locked: false,
    title: 'Checklist',
    items: [{ text: '', done: false }],
  };
  state.todos = state.todos || [];
  state.todos.push(todo);
  renderTodo(todo);
  updateItemStyle(todo);
  selectOnly(todo.id);
  scheduleAutoSave();
  return todo;
}

export function renderTodo(todo) {
  const el = todo.el;
  el.innerHTML = '';
  // Header
  const header = document.createElement('div');
  header.className = 'todo-header';
  const titleInput = document.createElement('input');
  titleInput.className = 'todo-title';
  titleInput.type = 'text';
  titleInput.value = todo.title || '';
  titleInput.placeholder = 'Checklist title';
  titleInput.oninput = (e) => { todo.title = e.target.value; scheduleAutoSave(); };
  titleInput.onmousedown = (e) => e.stopPropagation();
  const addBtn = document.createElement('button');
  addBtn.className = 'todo-add-btn';
  addBtn.textContent = '+ Add';
  addBtn.onmousedown = (e) => e.stopPropagation();
  addBtn.onclick = (e) => {
    e.stopPropagation();
    pushUndo();
    todo.items.push({ text: '', done: false });
    renderTodoList(todo);
    scheduleAutoSave();
    // Focus the new item
    requestAnimationFrame(() => {
      const inputs = todo.el.querySelectorAll('.todo-text');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    });
  };
  header.appendChild(titleInput);
  header.appendChild(addBtn);
  el.appendChild(header);
  // List
  const list = document.createElement('div');
  list.className = 'todo-list';
  el.appendChild(list);
  renderTodoList(todo);
  // Make draggable
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.todo-text') || e.target.closest('.todo-title') || e.target.closest('.todo-check') || e.target.closest('.todo-del') || e.target.closest('.todo-add-btn') || e.target.closest('.item-handle') || e.target.closest('.item-rot')) return;
    if (todo.locked) return;
    e.preventDefault();
    e.stopPropagation();
    // Select the todo item
    if (e.shiftKey) { toggleSelect(todo.id); } else { selectOnly(todo.id); }
    pushUndo();
    const startX = e.clientX, startY = e.clientY;
    const origX = todo.x, origY = todo.y;
    const onMove = (ev) => {
      todo.x = origX + (ev.clientX - startX) / state.zoom;
      todo.y = origY + (ev.clientY - startY) / state.zoom;
      updateItemStyle(todo);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      scheduleAutoSave();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export function renderTodoList(todo) {
  const list = todo.el.querySelector('.todo-list');
  if (!list) return;
  list.innerHTML = '';
  let doneCount = 0;
  todo.items.forEach((item, idx) => {
    if (item.done) doneCount++;
    const row = document.createElement('div');
    row.className = 'todo-row';
    // Checkbox
    const check = document.createElement('div');
    check.className = 'todo-check' + (item.done ? ' checked' : '');
    check.onmousedown = (e) => e.stopPropagation();
    check.onclick = (e) => {
      e.stopPropagation();
      item.done = !item.done;
      renderTodoList(todo);
      scheduleAutoSave();
    };
    // Text input
    const textInput = document.createElement('input');
    textInput.className = 'todo-text' + (item.done ? ' done' : '');
    textInput.type = 'text';
    textInput.value = item.text || '';
    textInput.placeholder = 'Type a task...';
    textInput.oninput = (e) => { item.text = e.target.value; scheduleAutoSave(); };
    textInput.onmousedown = (e) => e.stopPropagation();
    textInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        pushUndo();
        todo.items.splice(idx + 1, 0, { text: '', done: false });
        renderTodoList(todo);
        scheduleAutoSave();
        requestAnimationFrame(() => {
          const inputs = todo.el.querySelectorAll('.todo-text');
          if (inputs[idx + 1]) inputs[idx + 1].focus();
        });
      }
      if (e.key === 'Backspace' && !item.text && todo.items.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        pushUndo();
        todo.items.splice(idx, 1);
        renderTodoList(todo);
        scheduleAutoSave();
        requestAnimationFrame(() => {
          const inputs = todo.el.querySelectorAll('.todo-text');
          if (inputs[idx - 1]) inputs[idx - 1].focus();
        });
      }
    };
    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'todo-del';
    delBtn.textContent = '\u00d7';
    delBtn.onmousedown = (e) => e.stopPropagation();
    delBtn.onclick = (e) => {
      e.stopPropagation();
      if (todo.items.length <= 1) return;
      pushUndo();
      todo.items.splice(idx, 1);
      renderTodoList(todo);
      scheduleAutoSave();
    };
    row.appendChild(check);
    row.appendChild(textInput);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
  // Progress
  const progress = document.createElement('div');
  progress.className = 'todo-progress';
  progress.textContent = doneCount + '/' + todo.items.length + ' done';
  list.appendChild(progress);
  // Auto-measure actual height for handles, canvas export, etc.
  requestAnimationFrame(() => {
    const h = todo.el.offsetHeight;
    if (h && h !== todo.h) { todo.h = h; }
  });
}

window.addTodo = addTodo;
