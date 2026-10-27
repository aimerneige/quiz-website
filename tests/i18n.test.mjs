import test from 'node:test';
import assert from 'node:assert/strict';
import {languages,resolveLanguage,detectLanguage,setLanguage,getLanguage,tr,messages} from '../src/i18n.js';
import {readImport,parseCSV,exportJSON,exportCSV} from '../src/core.js';

test('only Chinese, Japanese and English are supported, with preference and fallback',()=>{
  assert.deepEqual(languages,['zh-CN','ja','en']);
  for(const [value,expected] of [['zh-TW','zh-CN'],['ja-JP','ja'],['en-GB','en'],['EN-us','en'],['fr',null],[null,null]])assert.equal(resolveLanguage(value),expected);
  assert.equal(detectLanguage('ja',['en-US']),'ja');
  assert.equal(detectLanguage('invalid',['fr-FR','en-US','ja']),'en');
  assert.equal(detectLanguage(null,['de-DE']),'zh-CN');
  setLanguage('ja');setLanguage('fr');assert.equal(getLanguage(),'ja');setLanguage('zh-CN');
});

test('every translation is complete and preserves all interpolation parameters',()=>{
  const parameters=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
  for(const [key,translations] of Object.entries(messages)){
    assert.equal(translations.length,2,key);
    for(const translation of translations){
      assert.ok(typeof translation==='string'&&translation.trim(),key);
      assert.deepEqual(parameters(translation),parameters(key),key);
    }
  }
});

test('language switches interpolate zero and literal parameter contents, with Chinese fallback',()=>{
  try{
    for(const language of languages){
      setLanguage(language);
      assert.ok(tr('显示 {count} 道题目',{count:0}).includes('0'));
      assert.ok(!tr('显示 {count} 道题目',{count:0}).includes('{count}'));
      assert.ok(tr('第 {row} 条：{message}',{row:2,message:'$& {count} <b>原文</b>'}).includes('$& {count} <b>原文</b>'));
      assert.equal(tr('未收录的中文'),'未收录的中文');
    }
    assert.equal(tr('缺少答案'),'Answer is required');
    setLanguage('ja');assert.equal(tr('缺少答案'),'解答がありません');
  }finally{setLanguage('zh-CN');}
});

test('validation follows the selected language while import aliases and question content stay unchanged',()=>{
  const input='题目,答案,标签\n原文,日本語 English,科学';
  try{
    for(const language of languages){
      setLanguage(language);
      const parsed=readImport(input,'csv');
      assert.equal(parsed.valid[0].question,'原文');
      assert.equal(parsed.valid[0].answer,'日本語 English');
      assert.deepEqual(parsed.valid[0].tags,['科学']);
      const invalid=readImport('[{"answer":"原文"}]','json');
      assert.equal(invalid.errors[0].message,tr('缺少题目'));
      assert.throws(()=>parseCSV('question,answer\na,b,c'),{message:tr('CSV 第 {row} 条记录的列数超过表头，请用双引号包住内容中的逗号',{row:1})});
      for(const [content,format] of [[exportJSON(parsed.valid),'json'],[exportCSV(parsed.valid),'csv']]){
        assert.equal(readImport(content,format).valid[0].answer,'日本語 English');
      }
    }
  }finally{setLanguage('zh-CN');}
});
