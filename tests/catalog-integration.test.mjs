import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogEntry, mergeCatalogRecords, legacyCatalogPayload } from '../src/catalog-integration.js';

test('nested directory seeds topics without using the file type as its category', () => {
  const entry = catalogEntry({ fullPath:'D:/library/fish.mp4', name:'fish.mp4', relativePath:'01_素材/下载素材/动物/鱼/fish.mp4', area:'下载素材', tags:['动物'], sizeBytes:42 }, 'D:/library');
  assert.deepEqual(entry.categoryPath, ['动物','鱼']);
  assert.equal(entry.rootPath,'D:/library');
});

test('catalog display metadata retains the exact original drag path and offline record', () => {
  const snapshot = {assets:[{ id:'stable-1', fullPath:'D:/files/fish.mp4', rootPath:'D:/files',name:'fish.mp4',extension:'mp4',size:123,modified:0,displayName:'鱼群游动',tags:['鱼缸'],categoryIds:['fish'],area:'下载素材',note:'水下',favorite:true,mediaType:'video',online:false,context:{relativePath:'fish.mp4'} }]};
  const [record] = mergeCatalogRecords([],snapshot, String);
  assert.equal(record.id,'D:/files/fish.mp4');
  assert.equal(record.assetId,'stable-1');
  assert.equal(record.name,'鱼群游动');
  assert.equal(record.originalName,'fish.mp4');
  assert.equal(record.sizeBytes,123);
  assert.equal(record.online,false);
});

test('legacy payload tolerates corrupt optional settings and keeps original keys', () => {
  const values = {'yu-notes':'{"D:/a.png":"参考"}','yu-favorites':'broken','yu-library-root':'D:/library'};
  const payload = legacyCatalogPayload({getItem:key=>values[key]});
  assert.deepEqual(payload.favorites,[]);
  assert.equal(payload.notes['D:/a.png'],'参考');
  assert.equal(payload.rootPath,'D:/library');
});

 test('managed projects retain an explicitly empty sourceRoot while linked projects retain their root', () => {
   const base={id:'managed',fullPath:'D:/library/02_项目素材/A/制作素材/a.png',rootPath:'D:/library',name:'a.png',extension:'png',size:1,modified:0,tags:[],categoryIds:[],area:'项目素材',online:true,context:{sourceRoot:'',project:'A',mode:'制作素材'}};
   const [managed]=mergeCatalogRecords([],{assets:[base]},String);
   assert.equal(managed.sourceRoot,'');
   const [linked]=mergeCatalogRecords([],{assets:[{...base,id:'linked',context:{...base.context,sourceRoot:'D:/project'}}]},String);
   assert.equal(linked.sourceRoot,'D:/project');
 });
