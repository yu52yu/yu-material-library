import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FILE_SORT, FILE_SORT_STORAGE_KEY, normalizeFileSort, sortFiles } from "../src/file-sort.js";

const ids = (files) => files.map((file) => file.id);
const by = (field, direction = "asc") => ({ field, direction });

test("sort preferences accept supported fields and directions and discard unrelated properties", () => {
  assert.equal(FILE_SORT_STORAGE_KEY, "yu-file-sort");
  assert.deepEqual(DEFAULT_FILE_SORT, by("modified", "desc"));
  for (const field of ["name", "modified", "size", "type"]) {
    for (const direction of ["asc", "desc"]) {
      assert.deepEqual(normalizeFileSort({ field, direction, unrelated: true }), { field, direction });
    }
  }
});

test("invalid preferences fall back to a fresh default without changing the shared default", () => {
  for (const raw of [undefined, null, true, 3, "{broken", '{"field":"size","direction":"asc"}', [], {}, { field: "name" }, { field: "date", direction: "asc" }, { field: "size", direction: "up" }]) {
    assert.deepEqual(normalizeFileSort(raw), DEFAULT_FILE_SORT);
  }
  const restored = normalizeFileSort(null);
  restored.field = "name";
  assert.deepEqual(DEFAULT_FILE_SORT, by("modified", "desc"));
});

test("file size sorts by byte count rather than display strings in either direction", () => {
  const files = [
    { id: "large", name: "1.png", size: "2 MB", sizeBytes: 2 * 1024 * 1024 },
    { id: "small", name: "2.png", size: "900 KB", sizeBytes: 900 * 1024 },
    { id: "tiny", name: "3.png", size: "10 KB", sizeBytes: 10 * 1024 },
  ];
  assert.deepEqual(ids(sortFiles(files, by("size"))), ["tiny", "small", "large"]);
  assert.deepEqual(ids(sortFiles(files, by("size", "desc"))), ["large", "small", "tiny"]);
});

test("modification time sorts chronologically and defaults to newest first", () => {
  const files = [
    { id: "old", name: "1.png", modified: "2025/12/31", modifiedAt: Date.parse("2025-12-31T23:00:00Z") },
    { id: "new", name: "2.png", modified: "2026/10/15", modifiedAt: Date.parse("2026-10-15T00:00:00Z") },
    { id: "middle", name: "3.png", modified: "2026/01/01", modifiedAt: Date.parse("2026-01-01T00:00:00Z") },
  ];
  assert.deepEqual(ids(sortFiles(files)), ["new", "middle", "old"]);
  assert.deepEqual(ids(sortFiles(files, by("modified"))), ["old", "middle", "new"]);
});

test("names use natural numeric Chinese collation for 2 and 10 in both directions", () => {
  const files = [
    { id: "10", name: "素材10.png" }, { id: "2", name: "素材2.png" }, { id: "1", name: "素材1.png" },
  ];
  assert.deepEqual(ids(sortFiles(files, by("name"))), ["1", "2", "10"]);
  assert.deepEqual(ids(sortFiles(files, by("name", "desc"))), ["10", "2", "1"]);
});

test("equal main values use ascending natural names then ids regardless of sort direction", () => {
  const files = [
    { id: "z", name: "素材2.png", sizeBytes: 20, modifiedAt: 10 },
    { id: "ten", name: "素材10.png", sizeBytes: 20, modifiedAt: 10 },
    { id: "a", name: "素材2.png", sizeBytes: 20, modifiedAt: 10 },
  ];
  for (const field of ["size", "modified"]) {
    for (const direction of ["asc", "desc"]) {
      assert.deepEqual(ids(sortFiles(files, by(field, direction))), ["a", "z", "ten"]);
    }
  }
  assert.deepEqual(ids(sortFiles([...files].reverse(), by("size", "desc"))), ["a", "z", "ten"]);
});

test("invalid numeric fields count as zero instead of sorting display values or propagating NaN", () => {
  const files = [
    { id: "finite", name: "z.png", sizeBytes: 2, modifiedAt: 2 },
    { id: "infinite", name: "b.png", sizeBytes: Infinity, modifiedAt: Infinity },
    { id: "missing", name: "a.png" },
    { id: "nan", name: "d.png", sizeBytes: NaN, modifiedAt: NaN },
    { id: "string", name: "c.png", sizeBytes: "100", modifiedAt: "100" },
  ];
  for (const field of ["size", "modified"]) {
    assert.deepEqual(ids(sortFiles(files, by(field))), ["missing", "infinite", "string", "nan", "finite"]);
    assert.deepEqual(ids(sortFiles(files, by(field, "desc"))), ["finite", "missing", "infinite", "string", "nan"]);
  }
});

test("type ordering normalizes extension casing and falls back to type", () => {
  const files = [
    { id: "psd", name: "z.psd", extension: ".PSD" },
    { id: "png2", name: "素材2.png", type: "PNG" },
    { id: "png1", name: "素材1.png", extension: "png", type: "IMAGE" },
    { id: "jpg", name: "z.jpg", extension: "JPG" },
  ];
  assert.deepEqual(ids(sortFiles(files, by("type"))), ["jpg", "png1", "png2", "psd"]);
  assert.deepEqual(ids(sortFiles(files, by("type", "desc"))), ["psd", "png1", "png2", "jpg"]);
});

test("sorting returns a new array, leaves original records unchanged, and tolerates missing inputs", () => {
  const files = [Object.freeze({ id: "2", name: "素材2" }), Object.freeze({ id: "1", name: "素材1" })];
  Object.freeze(files);
  const result = sortFiles(files, by("name"));
  assert.notEqual(result, files);
  assert.deepEqual(ids(files), ["2", "1"]);
  assert.deepEqual(ids(result), ["1", "2"]);
  assert.equal(result[0], files[1]);
  assert.deepEqual(sortFiles(null), []);
  assert.deepEqual(sortFiles([]), []);
});
