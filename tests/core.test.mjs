import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQuestion,readImport,mergeQuestions,exportJSON,exportCSV,parseCSV,filterQuestions,shuffle} from '../src/core.js';
import {seedQuestions,isSampleQuestion} from '../src/data.js';

test('sample detection survives storage and import IDs while preserving edited and personal questions',()=>{
  const imported=readImport(exportJSON(seedQuestions),'json').valid;
  assert.ok(imported.every(isSampleQuestion));
  assert.ok(seedQuestions.every(isSampleQuestion));
  const sample=seedQuestions[0];
  for(const key of ['question','hint','answer'])assert.equal(isSampleQuestion({...sample,[key]:'自定义内容'}),false);
  assert.equal(isSampleQuestion({...sample,tags:['自定义']}),false);
  assert.equal(isSampleQuestion(normalizeQuestion({question:'我的问题',answer:'我的答案'})),false);
});

test('JSON and CSV preserve multilingual, multiline, quoted content and unusual tag characters',()=>{
  const q=normalizeQuestion({question:'为什么？, "Why"\n第二行',hint:'提示\r\n下一行',answer:'答案, "quoted"\n=1+1',tags:['科学','a|b','a,b','词 组','"quoted"']});
  for(const [file,format] of [[exportJSON([q]),'json'],[exportCSV([q]),'csv']]){
    const parsed=readImport(file,format);assert.equal(parsed.errors.length,0);const {id,...actual}=parsed.valid[0];const {id:unused,...expected}=q;assert.deepEqual(actual,expected);
  }
});
test('CSV accepts BOM, Chinese headers, CRLF, quoted commas, and empty optional columns',()=>{
  const out=readImport('\uFEFF题目,提示,答案,标签\r\n"问题,一",,"答案""一","科学|生活"\r\n','csv');
  assert.equal(out.valid.length,1);assert.equal(out.valid[0].question,'问题,一');assert.equal(out.valid[0].answer,'答案"一');assert.deepEqual(out.valid[0].tags,['科学','生活']);
});
test('import validates individual rows and never silently invents required fields',()=>{
  const out=readImport(JSON.stringify([{question:'有效',answer:'答案'},null,{question:'无答案'},{question:'标签过长',answer:'答案',tags:['x'.repeat(41)]}]),'json');
  assert.equal(out.valid.length,2);assert.deepEqual(out.errors.map(e=>e.row),[2,4]);
  assert.throws(()=>readImport('{bad','json'),/JSON/);assert.throws(()=>parseCSV('question,answer\n"未关闭,内容'),/闭合/);assert.throws(()=>parseCSV('a,b\nx,y'),/首行/);assert.throws(()=>parseCSV('question,answer\n问题,答案,意外列'),/列数/);
});
test('question-only records can be imported, restored and completed later',()=>{
  for(const [content,format] of [['[{"question":"待补充"}]','json'],['question\n待补充','csv'],['题目\n待补充','csv'],['问题,答案\n待补充,   ','csv']]){
    const parsed=readImport(content,format);
    assert.deepEqual(parsed.errors,[]);
    const q=parsed.valid[0];
    assert.equal(q.question,'待补充');assert.equal(q.answer,'');assert.equal(q.hint,'');assert.deepEqual(q.tags,[]);
    for(const [backup,type] of [[exportJSON([q]),'json'],[exportCSV([q]),'csv']]){
      const restored=readImport(backup,type);
      assert.deepEqual(restored.errors,[]);assert.equal(restored.valid[0].answer,'');
    }
    const completed=normalizeQuestion({...q,hint:'提示',answer:'答案',tags:['标签']});
    assert.equal(completed.question,q.question);assert.equal(completed.hint,'提示');assert.equal(completed.answer,'答案');assert.deepEqual(completed.tags,['标签']);
  }
  assert.throws(()=>normalizeQuestion({question:'   '}),/缺少题目/);
});
test('append preserves existing IDs and replacement removes the old bank only when selected',()=>{
  const old=normalizeQuestion({question:'旧题',answer:'旧答案'});const newQ=normalizeQuestion({question:'新题',answer:'新答案'});
  const append=mergeQuestions([old],[old,newQ,newQ]);assert.equal(append.added,1);assert.equal(append.duplicates,2);assert.equal(append.questions[0].id,old.id);assert.equal(append.questions.length,2);
  const replacement=mergeQuestions([old],[newQ,newQ],true);assert.equal(replacement.added,1);assert.equal(replacement.duplicates,1);assert.equal(replacement.questions[0].question,'新题');
});
test('multi-tag filtering implements any, all, and zero-match states',()=>{
  assert.equal(filterQuestions(seedQuestions,[]).length,12);
  const any=filterQuestions(seedQuestions,['科学','生活'],'any');const all=filterQuestions(seedQuestions,['科学','生活'],'all');
  assert.ok(any.length>all.length);assert.ok(all.every(q=>q.tags.includes('科学')&&q.tags.includes('生活')));assert.equal(filterQuestions(seedQuestions,['英语','科学'],'all').length,0);
});
test('a random round has every eligible question exactly once and avoids repeat across rounds',()=>{
  const ids=seedQuestions.map(q=>q.id);for(let i=0;i<30;i++){const deck=shuffle(ids,ids[0]);assert.deepEqual([...deck].sort(),[...ids].sort());assert.notEqual(deck[0],ids[0]);assert.equal(new Set(deck).size,ids.length);}assert.deepEqual(shuffle([]),[]);assert.deepEqual(shuffle(['one'],'one'),['one']);
});
test('sample bank is valid and both export formats restore all sample records',()=>{
  for(const [content,format] of [[exportJSON(seedQuestions),'json'],[exportCSV(seedQuestions),'csv']]){const out=readImport(content,format);assert.equal(out.valid.length,12);assert.equal(out.errors.length,0);}
});
