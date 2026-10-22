import test from 'node:test';
import assert from 'node:assert/strict';
import { materialAreasFromCatalog, reusablePath } from '../src/material-areas.js';
import { catalogEntry } from '../src/catalog-integration.js';
import { currentDropTarget } from '../src/drop-target.js';

const areas = ['下载素材','AI制作素材','个人作品','2026作品'];

test('a restored registry includes built-ins and all custom material areas without duplicating names', () => {
  assert.deepEqual(materialAreasFromCatalog({settings:{customAreas:['个人作品','下载素材','2026作品']}}),areas);
});

test('custom material paths retain numeric area names and nested category hierarchy', () => {
  assert.deepEqual(reusablePath('01_素材/2026作品/03_插画/04_成品/作品.png',areas),{area:'2026作品',category:'插画',categoryPath:['插画','成品']});
  const entry = catalogEntry({area:'个人作品',name:'a.png',relativePath:'01_素材/个人作品/插画/成品/a.png',fullPath:'D:/library/01_素材/个人作品/插画/成品/a.png'},'D:/library',areas);
  assert.deepEqual(entry.categoryPath,['插画','成品']);
});

test('project folders and unregistered names cannot become reusable areas by matching a nested folder', () => {
  assert.equal(reusablePath('02_项目素材/项目/制作素材/个人作品/a.png',areas),null);
  assert.equal(reusablePath('01_素材/未注册区域/插画/a.png',areas),null);
});

test('external drops into an empty custom area target its own managed inbox', () => {
  const target = currentDropTarget({activeArea:'个人作品',category:'全部',files:[],rootPath:'D:/library',rootKind:'library',linkedProjects:[],materialAreas:areas});
  assert.equal(target.area,'个人作品');
  assert.equal(target.root,'D:/library');
  assert.equal(target.directory,'01_素材/个人作品/未分类');
});

test('custom area drops preserve existing ordered material roots and cannot fall back to another area', () => {
  const target = currentDropTarget({activeArea:'2026作品',category:'全部',files:[{area:'下载素材',category:'图片',relativePath:'12_素材/03_下载素材/图片/a.png'}],rootPath:'D:/library',rootKind:'library',linkedProjects:[],materialAreas:areas});
  assert.equal(target.directory,'12_素材/2026作品/未分类');
});

test('linked originals cannot supply a directory outside the managed material tree', () => {
  const target = currentDropTarget({activeArea:'2026作品',category:'全部',files:[{area:'2026作品',category:'插画',relativePath:'2026作品/插画/a.png',sourceRoot:'E:/originals',rootPath:'E:/originals'}],rootPath:'D:/library',rootKind:'library',linkedProjects:[],materialAreas:areas});
  assert.equal(target.directory,'01_素材/2026作品/未分类');
});

test('a custom area named 素材 matches the area folder after the managed root', () => {
  const target = currentDropTarget({activeArea:'素材',category:'全部',files:[{area:'素材',category:'插画',relativePath:'01_素材/素材/插画/a.png',rootPath:'D:/library'}],rootPath:'D:/library',rootKind:'library',linkedProjects:[],materialAreas:[...areas,'素材']});
  assert.equal(target.directory,'01_素材/素材/未分类');
});
