import {tr} from './i18n.js';
export const uid = () => globalThis.crypto?.randomUUID?.() || `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function parseTags(value) {
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { const a = JSON.parse(value); if (Array.isArray(a)) value = a; } catch {}
  }
  const a = Array.isArray(value) ? value : String(value || '').split(/[,，;；|\n]/);
  return [...new Set(a.map(t=>String(t).trim()).filter(Boolean))];
}
export function normalizeQuestion(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error(tr("题目必须是一个对象"));
  const get=(...keys)=>{for (const k of keys) if (row[k] != null) return row[k];return '';};
  const question=String(get('question','题目','问题')).trim();
  const answer=String(get('answer','答案')).trim();
  const hint=String(get('hint','提示')).trim();
  const tags=parseTags(get('tags','标签'));
  if (!question) throw Error(tr("缺少题目"));
  if (question.length>10000 || answer.length>30000 || hint.length>30000) throw Error(tr("题目最多 10,000 字，提示和答案最多 30,000 字"));
  if (tags.length>20 || tags.some(t=>t.length>40)) throw Error(tr("每题最多 20 个标签，每个标签最多 40 字"));
  return {id:uid(), question, hint, answer, tags};
}
export function parseCSV(input) {
  const text=input.replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (quoted) {
      if (c==='"') {if(text[i+1]==='"'){cell+='"';i++;}else {quoted=false;closed=true;}}
      else cell+=c;
    } else if (c===',' || c==='\n' || c==='\r') {
      row.push(cell);cell='';closed=false;
      if(c!==',') {if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}
    } else if(c==='"') {
      if(cell || closed)throw Error(tr("CSV 引号格式不正确，请将含逗号或换行的内容放在双引号内"));
      quoted=true;
    } else {if(closed && c.trim())throw Error(tr("CSV 双引号后有意外内容"));if(!closed)cell+=c;}
  }
  if(quoted)throw Error(tr("CSV 中有未闭合的双引号"));
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  if(!rows.length)throw Error(tr("文件内容为空"));
  const headers=rows.shift().map(h=>h.trim().toLowerCase());
  if(!headers.some(h=>['question','题目','问题'].includes(h)))throw Error(tr("CSV 首行需包含 question，或“题目 / 问题”列"));
  return rows.map((values,index)=>{
    if(values.length>headers.length)throw Error(`${tr('CSV 第 {row} 条记录的列数超过表头，请用双引号包住内容中的逗号',{row:index+1})}`);
    return Object.fromEntries(headers.map((h,i)=>[h,values[i]||'']));
  });
}
export function readImport(text, format) {
  let rows;
  if(format==='csv')rows=parseCSV(text);
  else {let parsed;try{parsed=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error(tr("JSON 格式无效，请检查逗号、引号和括号"));}rows=Array.isArray(parsed)?parsed:parsed?.questions;if(!Array.isArray(rows))throw Error(tr("JSON 应为题目数组，或包含 questions 数组的对象"));}
  if(rows.length>10000)throw Error(tr("单次最多导入 10,000 道题，请分批导入"));
  if(!rows.length)throw Error(tr("文件中没有题目"));
  const valid=[],errors=[];
  rows.forEach((row,i)=>{try{valid.push(normalizeQuestion(row));}catch(e){errors.push({row:i+1,message:e.message});}});
  return {valid,errors,total:rows.length};
}
export const signature = q => JSON.stringify([q.question.trim(),q.answer.trim()]);
export function mergeQuestions(current,incoming,replace=false) {
  const result=replace?[]:[...current],seen=new Set(result.map(signature));let duplicates=0;
  for(const q of incoming){const key=signature(q);if(seen.has(key)){duplicates++;continue;}seen.add(key);result.push({...q,id:uid()});}
  return {questions:result,added:result.length-(replace?0:current.length),duplicates};
}
export function exportJSON(questions) {return JSON.stringify({version:1,name:'quiz题库',exportedAt:new Date().toISOString(),questions},null,2);}
export function exportCSV(questions) {
  const escape=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  return '\uFEFF'+['question,hint,answer,tags',...questions.map(q=>[q.question,q.hint,q.answer,JSON.stringify(q.tags)].map(escape).join(','))].join('\r\n');
}
export function filterQuestions(questions,tags,mode='any') {
  if(!tags.length)return questions;
  return questions.filter(q=>mode==='all'?tags.every(t=>q.tags.includes(t)):tags.some(t=>q.tags.includes(t)));
}
export function shuffle(items, avoidFirst) {
  const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  if(a.length>1&&a[0]===avoidFirst)[a[0],a[1]]=[a[1],a[0]];
  return a;
}
