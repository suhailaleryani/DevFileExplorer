import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageClass, ageLabel, baseName, crumbs, formatDate, formatDateShort, formatSize, kindOf, parentOf, typeLabel,
} from "../../src/util.ts";

const file = (ext: string, name = `f.${ext}`) =>
  ({ name, path: `C:\\x\\${name}`, isDir: false, size: 1, modified: 0, created: 0, ext }) as never;
const dir = { name: "d", path: "C:\\d", isDir: true, size: 0, modified: 0, created: 0, ext: "" } as never;

test("baseName: windows, posix, trailing separators, bare names", () => {
  assert.equal(baseName("C:\\a\\b\\c.txt"), "c.txt");
  assert.equal(baseName("/a/b/c.txt"), "c.txt");
  assert.equal(baseName("C:\\a\\b\\"), "b");
  assert.equal(baseName("/a/b//"), "b");
  assert.equal(baseName("name"), "name");
  assert.equal(baseName("C:\\"), "C:");
});

test("parentOf: goes up one level and keeps drive roots valid", () => {
  assert.equal(parentOf("C:\\a\\b"), "C:\\a");
  assert.equal(parentOf("C:\\a"), "C:\\");
  assert.equal(parentOf("C:\\a\\b\\"), "C:\\a");
  assert.equal(parentOf("/a/b"), "/a");
  assert.equal(parentOf("/a"), "/");
});

test("crumbs: windows path", () => {
  assert.deepEqual(crumbs("D:\\Projects\\App"), [
    { name: "D:", path: "D:\\" },
    { name: "Projects", path: "D:\\Projects" },
    { name: "App", path: "D:\\Projects\\App" },
  ]);
});

test("crumbs: posix path and empty path", () => {
  assert.deepEqual(crumbs("/usr/lib"), [
    { name: "usr", path: "/usr" },
    { name: "lib", path: "/usr/lib" },
  ]);
  assert.deepEqual(crumbs(""), [{ name: "/", path: "/" }]);
});

test("formatSize: units and rounding", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(1024 * 1024), "1.0 MB");
  assert.equal(formatSize(150 * 1024 * 1024), "150 MB");
  assert.equal(formatSize(1024 ** 3), "1.0 GB");
  assert.equal(formatSize(1024 ** 4 * 5), "5.0 TB");
  assert.equal(formatSize(1024 ** 5), "1024 TB"); // capped at TB
});

test("formatDate / formatDateShort: zero is a dash, real dates are non-empty", () => {
  assert.equal(formatDate(0), "—");
  assert.equal(formatDateShort(0), "—");
  assert.ok(formatDate(Date.now()).length > 4);
  assert.ok(formatDateShort(Date.now()).length > 2);
  const old = new Date(2001, 5, 15).getTime();
  assert.match(formatDateShort(old), /2001/); // older years show the year
});

test("typeLabel: folders, known, unknown and missing extensions", () => {
  assert.equal(typeLabel(dir), "Folder");
  assert.equal(typeLabel(file("")), "File");
  assert.equal(typeLabel(file("tsx")), "TypeScript React");
  assert.equal(typeLabel(file("PDF")), "PDF document");
  assert.equal(typeLabel(file("xyz")), "XYZ file");
});

test("kindOf: categories", () => {
  assert.equal(kindOf(dir), "folder");
  const cases: [string, string][] = [
    ["png", "image"], ["mp4", "video"], ["mp3", "audio"], ["zip", "archive"], ["pdf", "pdf"], ["md", "doc"],
    ["csv", "sheet"], ["rs", "code"], ["json", "config"], ["exe", "exe"], ["zzz", "file"], ["", "file"],
  ];
  for (const [ext, kind] of cases) assert.equal(kindOf(file(ext)), kind, ext);
  assert.equal(kindOf(file("PNG")), "image"); // case-insensitive
});

test("ageClass: boundaries follow the thresholds", () => {
  const t: [number, number, number] = [7, 30, 90];
  const ago = (d: number) => Date.now() - d * 86_400_000;
  assert.equal(ageClass(0, t), "age-none");
  assert.equal(ageClass(ago(1), t), "age-green");
  assert.equal(ageClass(ago(7.1), t), "age-yellow");
  assert.equal(ageClass(ago(31), t), "age-orange");
  assert.equal(ageClass(ago(91), t), "age-red");
});

test("ageLabel: today, days, weeks, months, years", () => {
  const ago = (d: number) => Date.now() - d * 86_400_000 - 1000;
  assert.equal(ageLabel(0), "—");
  assert.equal(ageLabel(Date.now()), "today");
  assert.equal(ageLabel(ago(3)), "3d");
  assert.equal(ageLabel(ago(14)), "2w");
  assert.equal(ageLabel(ago(90)), "3mo");
  assert.equal(ageLabel(ago(800)), "2y");
});
