// 테스트용 메모리 Firestore (store.js가 쓰는 기능만). 저장된 원본 문서를 직접 들여다볼 수 있다.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-admin/firestore') return { Timestamp: { fromMillis: (ms) => ({ toMillis: () => ms }) } };
  return origLoad.call(this, request, ...rest);
};

const cl = (d) => (d && typeof d === 'object' && !Array.isArray(d) && !d.toMillis ? Object.fromEntries(Object.entries(d).map(([k, v]) => [k, cl(v)])) : d);
function makeFakeDb() {
  const data = new Map(); // path -> doc
  let n = 0;
  const colRef = (path) => ({
    doc: (id) => docRef(`${path}/${id}`),
    async add(d) { const id = 'a' + ++n; data.set(`${path}/${id}`, cl(d)); return { id }; },
    orderBy(f, dir) { return query(path, f, dir, 1e9); },
    limit(k) { return query(path, null, 'asc', k); },
    where(f, op, v) { return query(path, null, 'asc', 1e9, [[f, op, v]]); },
    count: () => ({ get: async () => ({ data: () => ({ count: [...data.keys()].filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).length }) }) }),
  });
  const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b };
  const query = (path, f, dir, k, conds = []) => ({
    orderBy: (f2, d2) => query(path, f2, d2, k, conds),
    limit: (k2) => query(path, f, dir, k2, conds),
    where: (f2, op, v) => query(path, f, dir, k, [...conds, [f2, op, v]]),
    async get() {
      let ids = [...data.keys()].filter((p) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'));
      let docs = ids.map((p) => ({ id: p.split('/').pop(), data: () => data.get(p) }));
      docs = docs.filter((d) => conds.every(([cf, op, v]) => OPS[op](d.data()[cf], v)));
      if (f) docs.sort((a, b) => (dir === 'desc' ? -1 : 1) * ((a.data()[f] || 0) - (b.data()[f] || 0)));
      return { docs: docs.slice(0, k) };
    },
    count: () => colRef(path).count(),
  });
  const docRef = (path) => ({
    _path: path,
    collection: (c) => colRef(`${path}/${c}`),
    async get() { const d = data.get(path); return { exists: !!d, data: () => d }; },
    async set(d, opt) { data.set(path, opt && opt.merge ? { ...(data.get(path) || {}), ...cl(d) } : cl(d)); },
    async update(d) { if (!data.has(path)) throw new Error('not found'); data.set(path, { ...data.get(path), ...d }); },
    async delete() { data.delete(path); },
  });
  return {
    data,
    collection: (c) => colRef(c),
    async runTransaction(fn) {
      return fn({
        get: (ref) => ref.get(),
        set: (ref, d, opt) => ref.set(d, opt),
      });
    },
    async recursiveDelete(ref) {
      const prefix = ref._path;
      for (const k of [...data.keys()]) if (k === prefix || k.startsWith(prefix + '/')) data.delete(k);
    },
  };
}
module.exports = { makeFakeDb };
