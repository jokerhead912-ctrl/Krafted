// Diagnostic (NOT a regression suite — run by hand, deliberately outside
// test_v7*.js so run_all.sh never picks it up).
//
// Question: does _handleEntryDrop()'s hand-rolled `pending` counter ever
// reach 0 for the shapes a real folder drop produces? If it does not,
// _finishFolderImport() is never called and the drop is a silent no-op —
// which is exactly the "drag a folder in, nothing happens" report.
//
// The function is copied verbatim from kraftpub-dev.html (v7.4.0, 24870)
// with only the two async primitives stubbed. Both go through one FIFO
// macrotask queue, which is how Chrome actually orders entry.file() and
// reader.readEntries() callbacks.

'use strict';

function simulate(makeEntries, label) {
  const q = [];                       // FIFO macrotask queue
  const later = fn => q.push(fn);
  let finished = false;
  let finishFiles = -1;
  let allFiles = [];

  // ---- verbatim copy of _handleEntryDrop ----
  var pending = 0;
  function _finishFolderImport(allFiles) { finished = true; finishFiles = allFiles.length; }

  function _handleEntryDrop(entries) {
    allFiles = [];
    pending = entries.length;

    function readEntry(entry, path) {
      if (entry.isFile) {
        pending++;
        later(function () {                       // entry.file(cb)
          allFiles.push(entry.name);
          pending--;
          if (pending === 0) _finishFolderImport(allFiles);
        });
      } else if (entry.isDirectory) {
        var reader = { readEntries: function (cb) { later(function () { cb(reader._next()); }); },
                       _i: 0, _next: function () {
                         // directory readers hand back at most `chunk` entries per call
                         const s = entry.children.slice(this._i, this._i + reader._chunk);
                         this._i += reader._chunk;
                         return s;
                       },
                       _chunk: 100 };
        var subPath = path ? path + '/' + entry.name : entry.name;
        function readBatch() {
          reader.readEntries(function (batch) {
            if (batch.length === 0) {
              pending--;
              if (pending === 0) _finishFolderImport(allFiles);
              return;
            }
            pending += batch.length;
            batch.forEach(function (subEntry) { readEntry(subEntry, subPath); });
            pending--; // this batch done
            readBatch(); // continue reading
          });
        }
        readBatch();
      } else {
        pending--;
        if (pending === 0) _finishFolderImport(allFiles);
      }
    }

    entries.forEach(function (entry) { readEntry(entry, ''); });
  }
  // ---- end copy ----

  _handleEntryDrop(makeEntries());

  // drain
  let guard = 0;
  while (q.length && guard++ < 100000) q.shift()();

  return { label, finished, finishFiles, collected: allFiles.length, pendingLeft: pending };
}

// entry factories
const F = name => ({ isFile: true, name });
const D = (name, children) => ({ isDirectory: true, name, children });

const CASES = [
  ['A  1 top-level file',            () => [F('a.jpg')]],
  ['B  folder, 1 image',             () => [D('Shirts', [F('a.jpg')])]],
  ['C  folder, 3 images',            () => [D('Shirts', [F('a.jpg'), F('b.jpg'), F('c.jpg')])]],
  ['D  folder, 10 images',           () => [D('Shirts', Array.from({ length: 10 }, (_, i) => F(i + '.jpg')))]],
  ['E  folder + subfolder, 2 + 2',   () => [D('Root', [F('a.jpg'), F('b.jpg'), D('Sub', [F('c.jpg'), F('d.jpg')])])]],
  ['F  2 folders, 3 images each',    () => [D('A', [F('1.jpg'), F('2.jpg'), F('3.jpg')]),
                                            D('B', [F('4.jpg'), F('5.jpg'), F('6.jpg')])]],
];

let bad = 0;
console.log('shape                          finish?  imported  pending-left');
console.log('----------------------------------------------------------------');
for (const [label, mk] of CASES) {
  const r = simulate(mk, label);
  const ok = r.finished && r.finishFiles === r.collected;
  if (!ok) bad++;
  console.log(
    label.padEnd(30) +
    (r.finished ? 'yes    ' : 'NO     ').padEnd(9) +
    String(r.finished ? r.finishFiles : r.collected).padEnd(10) +
    String(r.pendingLeft) +
    (ok ? '' : '   <-- SILENT NO-OP')
  );
}
console.log('----------------------------------------------------------------');
console.log(bad + ' of ' + CASES.length + ' shapes never reach _finishFolderImport');
