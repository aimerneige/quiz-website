import {tr,languages,languageKey,detectLanguage,getLanguage,setLanguage} from './i18n.js';
import {seedQuestions,isSampleQuestion} from './data.js';
import {uid,parseTags,normalizeQuestion,readImport,mergeQuestions,exportJSON,exportCSV,filterQuestions,shuffle} from './core.js';

const paths={
  book:'<path d="M5 4h14v17l-7-4-7 4z"/><path d="M9 8h6M9 11h4"/>',
  cards:'<rect x="5" y="7" width="14" height="14" rx="3"/><path d="M8 3h8M9 11h6M9 15h4"/>',
  library:'<path d="M4 5h4v15H4zM10 5h4v15h-4zM16 6l3-1 4 14-3 1z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon:'<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14z"/>',
  language:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z"/>',
  monitor:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  chevron:'<path d="m8 5 7 7-7 7"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back:'<path d="M20 12H4m6-6-6 6 6 6"/>',
  shuffle:'<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 5-6s5-6 7-6h3m-4-4 4 4-4 4"/>',
  bulb:'<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  tag:'<path d="m3 3 8 .5L21 13 13 21 3.5 11z"/><circle cx="7.5" cy="7.5" r="1"/>',
  leaf:'<path d="M20 3c-10 0-17 4-15 12 8 4 15-2 15-12Z"/><path d="M4 21c1-6 6-11 11-14"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file:'<path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8m-8 4h6"/>',
  code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-5 2 2-16"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>'
};
const icon=(name,cls='')=>`<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}">${paths[name]||paths.file}</svg>`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s);
const KEY='zhijian-bank-v1';
let savedLanguage=null;try{savedLanguage=localStorage.getItem(languageKey);}catch{}
setLanguage(detectLanguage(savedLanguage,navigator.languages||[navigator.language]));
let storageWarning='',rawRecovery='';
let questions=[];
try {
  const raw=localStorage.getItem(KEY);
  if(raw===null){questions=seedQuestions.map(q=>({...q,tags:[...q.tags]}));localStorage.setItem(KEY,JSON.stringify({version:1,questions}));}
  else {rawRecovery=raw;const saved=JSON.parse(raw);if(!Array.isArray(saved.questions))throw Error();const ids=new Set();questions=saved.questions.map(q=>{const normal=normalizeQuestion(q);const id=typeof q.id==='string'&&!ids.has(q.id)?q.id:uid();ids.add(id);return {...normal,id};});rawRecovery='';}
}catch{storageWarning='浏览器暂时无法读取或保存本地题库。你仍可练习；请导出备份，并检查浏览器的存储设置。';}
let theme='system';try{theme=localStorage.getItem('zhijian-theme')||'system';}catch{}
if(!['system','light','dark'].includes(theme))theme='system';
const media=matchMedia('(prefers-color-scheme: dark)');
const state={view:'practice',questions,tags:[],match:'any',deck:[],index:0,round:1,hint:false,answer:false,search:'',libraryTag:'',page:1,theme,themeMenu:false,languageMenu:false,sidebarCollapsed:matchMedia('(max-width:960px)').matches,filtersCollapsed:false};
let dialogMode='',formTags=[],formId=null,pendingImport=null,snackbarTimer=null;
const PAGE_SIZE=8;
const allTags=()=>[...new Set(state.questions.flatMap(q=>q.tags))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
const pool=()=>filterQuestions(state.questions,state.tags,state.match);
const current=()=>state.questions.find(q=>q.id===state.deck[state.index]);
function resetDeck(preferred=null){
  state.deck=shuffle(pool().map(q=>q.id));
  if(preferred&&state.deck.includes(preferred)){state.deck=state.deck.filter(id=>id!==preferred);state.deck.unshift(preferred);}
  state.index=0;state.round=1;state.hint=false;state.answer=false;
}
resetDeck(state.questions[0]?.id);
function saveBank(next){
  try{
    if(rawRecovery)throw Error(tr("原有数据暂时无法读取，请先导出原始备份或选择导入替换。"));
    localStorage.setItem(KEY,JSON.stringify({version:1,questions:next}));
  }catch(e){toast(rawRecovery?e.message:tr("保存失败：浏览器存储不可用或空间已满。请先导出备份。"));return false;}
  state.questions=next;storageWarning='';
  state.tags=state.tags.filter(t=>next.some(q=>q.tags.includes(t)));
  if(state.libraryTag&&!allTags().includes(state.libraryTag))state.libraryTag='';
  resetDeck();return true;
}
function applyTheme(){document.documentElement.dataset.theme=state.theme==='system'?(media.matches?'dark':'light'):state.theme;$('meta[name="theme-color"]').content=document.documentElement.dataset.theme==='dark'?'#101411':'#f7faf5';}
applyTheme();media.addEventListener('change',()=>{if(state.theme==='system')applyTheme();});
function toast(message,actionLabel='',action=null){
  clearTimeout(snackbarTimer);const node=$('#snackbar');node.innerHTML=`<span>${esc(message)}</span>${actionLabel?`<button type="button">${esc(actionLabel)}</button>`:''}`;node.classList.add('visible');if(action)node.querySelector('button').onclick=()=>{node.classList.remove('visible');action();};snackbarTimer=setTimeout(()=>node.classList.remove('visible'),actionLabel?8500:4800);
}
const brand=()=>`<div class="brand-mark">${icon('book')}</div><div class="brand-copy"><div class="brand-name">quiz</div><div class="brand-caption">${tr("ROOM TO RECALL")}</div></div>`;
function render(){
  document.documentElement.lang=getLanguage();
  document.title=tr('quiz · 本地答题空间');
  $('meta[name="description"]').content=tr('quiz，一个安静的本地答题空间。管理自己的题库，按标签随机练习，随时查看提示与答案。支持 JSON 和 CSV 导入导出。');
  $('.skip-link').textContent=tr('跳至主内容');
  $('#app').innerHTML=`<div class="shell ${state.sidebarCollapsed?'sidebar-collapsed':''}">
    <aside class="sidebar" aria-label="${tr("主导航")}"><div class="brand">${brand()}</div>
      <nav class="nav" id="sidebar-navigation"><button class="nav-item ${state.view==='practice'?'active':''}" data-action="nav-practice" ${state.view==='practice'?'aria-current="page"':''} aria-label="${tr("抽题练习")}" title="${tr("抽题练习")}"><span class="nav-icon">${icon('cards')}</span><span class="nav-label">${tr("抽题练习")}</span></button><button class="nav-item ${state.view==='library'?'active':''}" data-action="nav-library" ${state.view==='library'?'aria-current="page"':''} aria-label="${tr("我的题库")}" title="${tr("我的题库")}"><span class="nav-icon">${icon('library')}</span><span class="nav-label">${tr("我的题库")}</span><span class="nav-count">${state.questions.length}</span></button></nav>
      <div class="sidebar-section eyebrow">${tr("YOUR LITTLE STUDY ROOM")}</div><div class="sidebar-tip">${icon('leaf')}<strong>${tr("给知识一点生长的时间")}</strong><p>${tr("不必一次记住所有。")}<br>${tr("每天回想一点，就很好。")}</p></div>
      <div class="sidebar-bottom"><div class="storage-note"><span class="status-dot"></span>${tr("只属于你的本地题库")}</div><p>${tr("无需账号 · 数据保存在当前浏览器")}</p></div>
      <button class="sidebar-toggle" data-action="toggle-sidebar" aria-expanded="${!state.sidebarCollapsed}" aria-controls="sidebar-navigation" aria-label="${state.sidebarCollapsed?tr("展开主导航"):tr("收起主导航")}" title="${state.sidebarCollapsed?tr("展开主导航"):tr("收起主导航")}">${icon(state.sidebarCollapsed?'chevron':'back')}<span>${tr("收起导航")}</span></button>
    </aside>
    <div class="workspace"><header class="topbar"><div class="mobile-brand"><div class="brand-mark">${icon('book')}</div>quiz</div><div class="breadcrumb"><span>${tr("学习空间")}</span>${icon('chevron')}<span>${state.view==='practice'?tr("抽题练习"):tr("我的题库")}</span></div><div class="top-actions"><button class="icon-btn" data-action="language-menu" aria-label="${tr("语言")}" aria-expanded="${state.languageMenu}" title="${tr("语言")}">${icon('language')}</button><span class="autosave">${icon(storageWarning?'lock':'checkCircle')}${storageWarning?tr("请检查存储"):tr("数据已保存在本地")}</span><button class="icon-btn" data-action="theme-menu" aria-label="${tr("切换主题")}" aria-expanded="${state.themeMenu}" title="${tr("外观主题")}">${icon(document.documentElement.dataset.theme==='dark'?'moon':'sun')}</button></div></header>
    ${state.themeMenu?themeMenu():''}${state.languageMenu?languageMenu():''}<main class="content" id="main">${storageWarning?`<div class="storage-warning">${esc(tr(storageWarning))}${rawRecovery?`<button class="text-link" data-action="recovery-export">${tr("导出原始备份")}</button>`:''}</div>`:''}${state.view==='practice'?practiceView():libraryView()}<footer class="page-footer"><span>${icon('lock')} ${tr("所有学习数据，仅保存在此浏览器")}</span><span class="footer-brand">quiz<span class="tiny-dot">/</span>${tr("让每一次回想都有收获")}</span></footer></main></div></div>`;
  if(state.view==='library')renderLibraryList();
}
function themeMenu(){return `<div class="menu-popover" role="group" aria-label="${tr("外观主题")}">${[['light','sun',tr("亮色主题")],['dark','moon',tr("暗色主题")],['system','monitor',tr("跟随系统")]].map(([value,i,label])=>`<button data-action="set-theme" data-value="${value}" class="${state.theme===value?'selected':''}" aria-pressed="${state.theme===value}">${icon(i)}${label}${state.theme===value?icon('check','check'):''}</button>`).join('')}</div>`;}
function languageMenu(){return `<div class="menu-popover" role="group" aria-label="${tr("语言")}">${languages.map(value=>`<button data-action="set-language" data-value="${value}" lang="${value}" class="${getLanguage()===value?'selected':''}" aria-pressed="${getLanguage()===value}">${icon('language')}${{'zh-CN':'中文',ja:'日本語',en:'English'}[value]}${getLanguage()===value?icon('check','check'):''}</button>`).join('')}</div>`;}
function practiceView(){return `<div class="page-heading"><div><div class="page-kicker"><span></span>${tr("A LITTLE EVERY DAY")}</div><h1>${tr("让知识，在回想中生长。")}</h1><p class="page-subtitle">${tr("选一个方向，抽一道题。给自己一点思考的时间。")}</p></div><button class="button outlined heading-button" data-action="nav-library">${icon('library')}${tr("管理题库")}</button></div>
  <div class="practice-layout ${state.filtersCollapsed?'filters-collapsed':''}"><aside class="filter-panel" aria-label="${tr("抽题筛选")}"><div class="filter-title"><h2>${tr("这次，想练些什么？")}</h2><button class="icon-btn small filter-toggle" data-action="toggle-filters" aria-expanded="${!state.filtersCollapsed}" aria-controls="filter-controls" aria-label="${state.filtersCollapsed?tr("展开抽题筛选"):tr("收起抽题筛选")}" title="${state.filtersCollapsed?tr("展开抽题筛选"):tr("收起抽题筛选")}">${icon('chevron')}</button></div><div id="filter-controls" ${state.filtersCollapsed?'hidden':''}><p class="filter-caption">${tr("选择标签，找到今天的学习方向。")}</p><div class="filter-tags-wrap"><button class="tag-chip all-chip ${!state.tags.length?'selected':''}" data-action="all-tags" aria-pressed="${!state.tags.length}">${icon(!state.tags.length?'check':'grid')}${tr("全部题目")}<span class="count">${state.questions.length}</span></button><div class="tag-list">${allTags().map(t=>`<button class="tag-chip ${state.tags.includes(t)?'selected':''}" data-action="toggle-tag" data-tag="${esc(t)}" aria-pressed="${state.tags.includes(t)}">${state.tags.includes(t)?icon('check'):''}${esc(t)}<span class="count">${state.questions.filter(q=>q.tags.includes(t)).length}</span></button>`).join('')||`<div class="empty-filter">${tr("添加题目和标签，从这里开始。")}</div>`}</div></div><div class="match-settings"><p class="match-label">${tr("多个标签的匹配方式")}</p><div class="segmented" role="group" aria-label="${tr("标签匹配方式")}"><button class="${state.match==='any'?'selected':''}" data-action="match-any" aria-pressed="${state.match==='any'}">${tr("满足任一标签")}</button><button class="${state.match==='all'?'selected':''}" data-action="match-all" aria-pressed="${state.match==='all'}">${tr("包含全部标签")}</button></div></div><p class="filter-bottom">${tr('共 {count} 道题符合条件',{count:pool().length})}${state.tags.length?` <button class="text-link" data-action="reset-filters">${tr("重置")}</button>`:''}<br>${tr("随机抽取，每轮不重复。")}</p></div></aside>
  <div class="study-column"><div id="question-zone">${questionCard()}</div><div class="study-note"><div><div class="study-note-title">${icon('spark')}${tr("先回想，再揭晓。")}</div><p>${tr("主动回忆，比反复阅读多一点挑战，也多一点收获。")}</p></div><div class="note-art" aria-hidden="true"><svg viewBox="0 0 75 55"><rect x="20" y="8" width="30" height="39" rx="5" transform="rotate(-14 35 28)"/><rect x="28" y="8" width="30" height="39" rx="5" fill="var(--secondary)" transform="rotate(10 43 28)"/><path d="m36 26 5 5 9-10M8 12v7m-3-3h6M63 37v8m-4-4h8"/></svg></div></div><div class="keyboard-note"><span class="key">Space</span>${tr("查看答案")}<span class="separator">·</span><span class="key">H</span>${tr("查看提示")}<span class="separator">·</span><span class="key">→</span>${tr("下一题")}</div></div></div>`;}
function questionCard(){
  const q=current();
  if(!q)return `<article class="question-card"><div class="empty-state"><div class="empty-icon">${icon(state.questions.length?'search':'book')}</div><h2>${state.questions.length?tr("这个组合，暂时没有题目"):tr("把你的第一道题，放进来。")}</h2><p>${state.questions.length?tr("试试减少标签，或切换为“满足任一标签”。也可以添加属于这个方向的新题目。"):tr("手动添加题目，或导入已有的 JSON / CSV 题库。你的学习空间，由你定义。")}</p><div class="empty-actions">${state.questions.length?`<button class="button outlined" data-action="reset-filters">${tr("重置筛选")}</button>`:`<button class="button outlined" data-action="import">${tr("导入题库")}</button>`}<button class="button primary" data-action="new-question">${icon('plus')}${tr("添加题目")}</button></div></div></article>`;
  return `<article class="question-card fade-in" aria-labelledby="question-title"><div class="question-content"><div class="question-meta"><span class="question-number">${tr("QUESTION")} ${String(state.index+1).padStart(2,'0')}</span><div class="question-tags">${isSampleQuestion(q)?`<span class="badge">${tr("系统示例")}</span>`:''}${q.tags.map(t=>`<span class="badge">${esc(t)}</span>`).join('')}</div></div><h2 class="question-title" id="question-title" tabindex="-1">${esc(q.question)}</h2><p class="think-prompt">${icon('clock')}${tr("不急着看答案，先试着回想一下")}</p>
    <div class="reveal-section"><button class="reveal-toggle" id="hint-toggle" data-action="toggle-hint" aria-expanded="${state.hint}" aria-controls="hint-content">${icon('bulb')}${tr("给我一点提示")}<span class="trailing">${state.hint?tr("收起提示"):tr("点击展开")}${icon('down')}</span></button><div class="reveal-content" id="hint-content" ${state.hint?'':'hidden'}>${esc(q.hint||tr("这道题还没有提示。相信自己的第一反应，或者直接查看答案。"))}</div></div>
    <div class="reveal-section"><button class="reveal-toggle answer" id="answer-toggle" data-action="toggle-answer" aria-expanded="${state.answer}" aria-controls="answer-content">${icon('eye')}${tr("查看参考答案")}<span class="trailing">${state.answer?tr("收起答案"):tr("想好再看")}${icon('down')}</span></button><div class="reveal-content answer-content" id="answer-content" ${state.answer?'':'hidden'}>${esc(q.answer||tr("这道题还没有答案，可以稍后编辑补充。"))}</div></div></div>
    <div class="question-actions"><div class="round-progress"><div class="progress-track"><div class="progress-fill" style="width:${(state.index+1)/state.deck.length*100}%"></div></div><span>${tr("本轮")} <strong>${state.index+1}</strong> / ${state.deck.length}</span></div><div class="next-actions"><button class="icon-btn small" data-action="edit-current" title="${tr("编辑这道题")}" aria-label="${tr("编辑这道题")}">${icon('edit')}</button><button class="icon-btn small" data-action="previous" ${state.index===0?'disabled':''} title="${tr("上一题")}" aria-label="${tr("上一题")}">${icon('back')}</button><button class="button primary" data-action="next">${icon('shuffle')}${state.index===state.deck.length-1?tr("开始下一轮"):tr("再来一题")}</button></div></div></article>`;
}
function renderQuestion(focus=false){$('#question-zone').innerHTML=questionCard();if(focus)$('#question-title')?.focus({preventScroll:true});}
function libraryView(){return `<div class="page-heading library-heading"><div><div class="page-kicker"><span></span>${tr("YOUR KNOWLEDGE COLLECTION")}</div><h1>${tr("我的题库")}</h1><p class="page-subtitle">${tr("把值得记住的，留在这里。")}</p><div class="library-summary"><span><strong>${state.questions.length}</strong>${tr("道题目")}</span><span><strong>${allTags().length}</strong>${tr("个标签")}</span><span>${tr("保存在当前浏览器")}</span></div></div><div class="library-actions">${state.questions.some(isSampleQuestion)?`<button class="button outlined" data-action="delete-samples">${icon('trash')}${tr("一键删除示例")}</button>`:''}<button class="button outlined" data-action="import">${icon('upload')}${tr("导入")}</button><button class="button outlined" data-action="export" ${!state.questions.length?'disabled':''}>${icon('download')}${tr("导出")}</button><button class="button primary" data-action="new-question">${icon('plus')}${tr("添加题目")}</button></div></div><div class="library-toolbar"><label class="search-field">${icon('search')}<input id="library-search" type="search" aria-label="${tr("搜索题目、答案或标签")}" placeholder="${tr("搜索题目、答案或标签…")}" value="${esc(state.search)}"><button class="icon-btn small search-clear" data-action="clear-search" aria-label="${tr("清空搜索")}" ${!state.search?'hidden':''}>${icon('close')}</button></label><select id="library-tag" aria-label="${tr("按标签筛选题库")}"><option value="">${tr("全部标签")}</option>${allTags().map(t=>`<option value="${esc(t)}" ${t===state.libraryTag?'selected':''}>${esc(t)}</option>`).join('')}</select><span class="result-count" id="result-count"></span></div><div id="library-list"></div><div class="library-info">${icon('file')}<span>${tr("已有自己的题库？支持 JSON、CSV 格式，导入前可预览和检查。")}</span><button class="text-link" data-action="import-guide">${tr("查看格式说明")} ${icon('arrow')}</button></div>`;}
function libraryResults(){const query=state.search.trim().toLocaleLowerCase();return state.questions.filter(q=>(!state.libraryTag||q.tags.includes(state.libraryTag))&&(!query||[q.question,q.answer,q.hint,...q.tags].some(v=>v.toLocaleLowerCase().includes(query))));}
function renderLibraryList(){
  const results=libraryResults();const pages=Math.max(1,Math.ceil(results.length/PAGE_SIZE));state.page=Math.min(state.page,pages);$('#result-count').textContent=`${tr('显示 {count} 道题目',{count:results.length})}`;
  const start=(state.page-1)*PAGE_SIZE;
  $('#library-list').innerHTML=results.length?`<div class="question-list">${results.slice(start,start+PAGE_SIZE).map((q,i)=>`<article class="library-row"><span class="row-number">${String(start+i+1).padStart(2,'0')}</span><div class="row-body"><h2 class="row-title">${esc(q.question)}</h2><div class="row-tags">${isSampleQuestion(q)?`<span class="badge">${tr("系统示例")}</span>`:''}${q.tags.map(t=>`<span class="badge">${esc(t)}</span>`).join('')}${q.hint?`<span class="row-detail">${icon('bulb')}${tr("含提示")}</span>`:''}</div></div><div class="row-actions"><button class="icon-btn" data-action="edit-question" data-id="${esc(q.id)}" aria-label="${tr('编辑第 {number} 题',{number:start+i+1})}" title="${tr("编辑题目")}">${icon('edit')}</button><button class="icon-btn delete" data-action="delete-question" data-id="${esc(q.id)}" aria-label="${tr('删除第 {number} 题',{number:start+i+1})}" title="${tr("删除题目")}">${icon('trash')}</button></div></article>`).join('')}</div><div class="pagination"><span>${tr('共 {count} 道题 · 第 {page} / {pages} 页',{count:results.length,page:state.page,pages})}</span><div class="pagination-actions"><button class="button outlined" data-action="page-prev" ${state.page<=1?'disabled':''}>${tr("上一页")}</button><button class="button outlined" data-action="page-next" ${state.page>=pages?'disabled':''}>${tr("下一页")}</button></div></div>`:`<div class="question-card empty-state"><div class="empty-icon">${icon(state.questions.length?'search':'book')}</div><h2>${state.questions.length?tr("没有找到匹配的题目"):tr("题库还是一张白纸")}</h2><p>${state.questions.length?tr("换个关键词，或试试其他标签。"):tr("添加第一道题目，或导入一份题库，开始积累自己的知识。")}</p><div class="empty-actions"><button class="button primary" data-action="${state.questions.length?'clear-library-filters':'new-question'}">${state.questions.length?tr("清空筛选"):tr("添加题目")}</button>${!state.questions.length?`<button class="button outlined" data-action="load-samples">${tr("载入示例题库")}</button>`:''}</div></div>`;
}
let returnFocus=null;
function openDialog(title,body,actions='',className=''){
  returnFocus=document.activeElement;
  const wrap=$('#dialogs');wrap.innerHTML=`<dialog class="modal ${className}" aria-labelledby="dialog-title"><div class="modal-header"><h2 id="dialog-title">${esc(title)}</h2><button type="button" class="icon-btn" data-dialog-action="close" aria-label="${tr("关闭对话框")}">${icon('close')}</button></div>${body}${actions?`<div class="modal-actions">${actions}</div>`:''}</dialog>`;
  const dialog=wrap.querySelector('dialog');dialog.showModal();dialog.addEventListener('close',()=>{wrap.innerHTML='';dialogMode='';if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
}
function closeDialog(){$('#dialogs dialog')?.close();}
function openQuestion(id=null){
  const q=state.questions.find(q=>q.id===id);formId=q?.id||null;formTags=q?[...q.tags]:[];
  openDialog(q?tr("编辑题目"):tr("添加新题目"),`<form id="question-form"><div class="modal-body"><p class="modal-description">${tr("可以先保存题目，稍后再补充提示、答案和标签。")}</p><label class="form-field"><span class="field-label">${tr("题目")}<span class="required">*</span></span><textarea name="question" placeholder="${tr("想要记住的问题是什么？")}" required maxlength="10000">${esc(q?.question||'')}</textarea></label><label class="form-field"><span class="field-label">${tr("提示")} <span class="field-help">${tr("（选填）")}</span></span><textarea name="hint" placeholder="${tr("给思路一点方向，不急着揭晓答案…")}" maxlength="30000">${esc(q?.hint||'')}</textarea></label><label class="form-field"><span class="field-label">${tr("参考答案")} <span class="field-help">${tr("（选填）")}</span></span><textarea class="large-textarea" name="answer" placeholder="${tr("写下答案，也可以补充解释和例子。")}" maxlength="30000">${esc(q?.answer||'')}</textarea></label><div class="form-field"><label class="field-label" for="tag-input">${tr("标签")} <span class="field-help">${tr("（选填）")}</span></label><input id="tag-input" placeholder="${tr("输入标签，按回车或用逗号分隔")}" maxlength="850" list="known-tags" autocomplete="off"><datalist id="known-tags">${allTags().map(t=>`<option value="${esc(t)}">`).join('')}</datalist><p class="field-help">${tr("一题可以有多个标签，最多 20 个。保存时会自动添加未确认的标签。")}</p><div class="tag-list form-tags" id="form-tags"></div></div><p class="form-error" id="form-error" role="alert"></p></div><div class="modal-actions"><button type="button" class="button text" data-dialog-action="close">${tr("取消")}</button><button type="submit" class="button primary">${icon('check')}${tr("保存题目")}</button></div></form>`);
  dialogMode='question';renderFormTags();
}
function renderFormTags(){$('#form-tags').innerHTML=formTags.map((t,i)=>`<span class="tag-chip selected">${esc(t)}<button type="button" data-dialog-action="remove-tag" data-index="${i}" aria-label="${tr('移除标签 {tag}',{tag:esc(t)})}">${icon('close')}</button></span>`).join('');}
function collectTags(){
  const input=$('#tag-input');const next=[...new Set([...formTags,...parseTags(input.value)])];
  if(next.length>20||next.some(t=>t.length>40)){$('#form-error').textContent=tr("最多 20 个标签，每个标签最多 40 字。");return false;}
  formTags=next;input.value='';$('#form-error').textContent='';renderFormTags();return true;
}
function openDelete(id){const q=state.questions.find(q=>q.id===id);if(!q)return;openDialog(tr("删除这道题？"),`<div class="modal-body"><div class="confirm-icon">${icon('trash')}</div><p class="confirm-text">${esc(q.question)}</p><p class="confirm-note">${tr("删除后，可通过底部提示立即撤销。")}</p></div>`,`<button class="button text" data-dialog-action="close">${tr("取消")}</button><button class="button danger" data-dialog-action="confirm-delete" data-id="${esc(id)}">${tr("删除题目")}</button>`);dialogMode='delete';}
function importGuide(){return `<details class="format-info"><summary>${tr("题库格式说明与模板")}</summary><div class="format-body"><p>${tr("JSON 支持题目数组，或包含 questions 数组的对象：")}</p><pre>[{ "question": "${tr("题目")}", "hint": "${tr("提示（选填）")}",\n   "answer": "${tr("答案")}", "tags": ["${tr("标签一")}", "${tr("标签二")}"] }]</pre><p>${tr("CSV 首行为列名，支持中英文。标签用 | 或逗号分隔，也支持 JSON 数组；含逗号、双引号或换行的字段须按 CSV 规则转义。")}</p><pre>question,hint,answer,tags\n${tr("光年是什么单位？")},${tr("想想光走过的距离")},${tr("距离单位")},${tr("科学")}|${tr("常识")}</pre><p>${tr("仅题目必填，提示、答案与标签选填。UTF-8 编码，单次最多 10 MB / 10,000 道题。")}</p><button class="button outlined" data-dialog-action="template-json">${icon('download')}${tr("JSON 模板")}</button> <button class="button outlined" data-dialog-action="template-csv">${icon('download')}${tr("CSV 模板")}</button></div></details>`;}
function openImport(expand=false){
  openDialog(tr("导入你的题库"),`<div class="modal-body"><p class="modal-description">${tr("让已有的积累，在这里继续生长。")}</p><button type="button" class="import-zone" id="drop-zone" style="width:100%" data-dialog-action="choose-file">${icon('upload')}<strong>${tr("点击选择，或将文件拖到这里")}</strong><p>${tr("JSON / CSV · 最大 10 MB · 文件仅在本地读取")}</p></button><p class="form-error" id="import-error" role="alert"></p>${importGuide()}</div>`,`<button class="button text" data-dialog-action="close">${tr("取消")}</button><button class="button primary" data-dialog-action="choose-file">${icon('file')}${tr("选择文件")}</button>`);
  dialogMode='import';pendingImport=null;if(expand)$('.format-info').open=true;
  const drop=$('#drop-zone');for(const name of ['dragenter','dragover'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.add('drag-over');});drop.addEventListener('dragleave',()=>drop.classList.remove('drag-over'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag-over');if(e.dataTransfer.files.length>1){$('#import-error').textContent=tr("请一次选择一个题库文件。");return;}readFile(e.dataTransfer.files[0]);});
}
async function readFile(file){
  if(!file)return;
  const error=message=>{if($('#import-error'))$('#import-error').textContent=message;else toast(message);};
  if(!/\.(json|csv)$/i.test(file.name)){error(tr("请选择 .json 或 .csv 文件。"));return;}
  if(file.size>10*1024*1024){error(tr("文件超过 10 MB，请拆分后再导入。"));return;}
  const active=$('#dialogs dialog');
  try{const content=await file.text();if(!active?.isConnected||dialogMode!=='import')return;const parsed=readImport(content,file.name.toLowerCase().endsWith('.csv')?'csv':'json');pendingImport={...parsed,name:file.name,replace:false};showImportPreview();}catch(e){error(e.message||tr("无法读取文件，请检查文件格式。"));}
}
function showImportPreview(){
  const p=pendingImport;if(!p)return;const preview=mergeQuestions(state.questions,p.valid,p.replace);
  openDialog(tr("确认导入题库"),`<div class="modal-body"><p class="modal-description">${tr("检查一下内容，再放进你的知识收藏。")}</p><div class="import-file-name">${icon('file')}<span>${esc(p.name)}</span><button class="text-link" data-dialog-action="reselect">${tr("重选")}</button></div><div class="import-stats"><div><strong>${preview.added}</strong><span>${tr("可导入题目")}</span></div><div><strong>${preview.duplicates}</strong><span>${tr("重复 · 自动跳过")}</span></div><div><strong>${p.errors.length}</strong><span>${tr("无效 · 自动跳过")}</span></div></div><div class="import-options"><label class="radio-option"><input type="radio" name="import-mode" value="append" ${!p.replace?'checked':''}><div><strong>${tr("追加到现有题库")}</strong><p>${tr('保留已有的 {count} 道题目，加入新内容。',{count:state.questions.length})}</p></div></label><label class="radio-option"><input type="radio" name="import-mode" value="replace" ${p.replace?'checked':''}><div><strong>${tr("替换整个题库")}</strong><p>${tr('移除现有 {count} 道题目，使用本次导入内容。请先导出备份。',{count:state.questions.length})}</p></div></label></div><p class="import-notes">${tr('题目与答案均相同的记录视为重复。导入后共 {count} 道题。',{count:preview.questions.length})}</p>${p.valid.length?`<p class="import-preview-label">${tr('内容预览 · 前 {count} 道',{count:Math.min(3,p.valid.length)})}</p>${p.valid.slice(0,3).map(q=>`<div class="import-preview-row">${esc(q.question)}</div>`).join('')}`:''}${p.errors.length?`<div class="import-errors"><strong>${tr('{count} 条内容无法导入',{count:p.errors.length})}</strong><ul>${p.errors.slice(0,10).map(e=>`<li>${tr('第 {row} 条：{message}',{row:e.row,message:esc(e.message)})}</li>`).join('')}</ul>${p.errors.length>10?tr("仅显示前 10 条错误。"):''}</div>`:''}<p class="form-error" id="import-error" role="alert"></p></div>`,`<button class="button text" data-dialog-action="close">${tr("取消")}</button><button class="button primary" data-dialog-action="confirm-import" ${!preview.added?'disabled':''}>${icon('check')}${p.replace?tr("替换并导入"):tr("确认导入")}${tr(' {count} 道题',{count:preview.added})}</button>`);
  dialogMode='import-preview';
}
function openExport(){openDialog(tr("带走你的知识收藏"),`<div class="modal-body"><p class="modal-description">${tr('导出完整题库，共 {count} 道题目。建议定期备份。',{count:state.questions.length})}</p><div class="export-options"><button class="export-option" data-dialog-action="export-json">${icon('code')}<strong>JSON</strong><p>${tr("完整保留题目、提示、答案和标签。适合备份与恢复。")}</p></button><button class="export-option" data-dialog-action="export-csv">${icon('grid')}<strong>CSV</strong><p>${tr("可用电子表格软件打开编辑，支持中文与多行内容。")}</p></button></div><p class="field-help">${tr("数据不会上传。导出的文件可随时重新导入quiz。")}</p></div>`,`<button class="button text" data-dialog-action="close">${tr("完成")}</button>`);dialogMode='export';}
function download(content,filename,type){
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportBank(format){const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());download(format==='csv'?exportCSV(state.questions):exportJSON(state.questions),`quiz题库-${date}.${format}`,format==='csv'?'text/csv;charset=utf-8':'application/json;charset=utf-8');toast(`${tr('已导出 {count} 道题目的 {format} 题库',{count:state.questions.length,format:format.toUpperCase()})}`);}
function changeView(view){state.view=view;state.themeMenu=false;state.languageMenu=false;render();window.scrollTo({top:0});$('#main h1')?.setAttribute('tabindex','-1');$('#main h1')?.focus({preventScroll:true});}
function nextQuestion(){if(!current())return;if(state.index<state.deck.length-1)state.index++;else{const old=state.deck.at(-1);state.deck=shuffle(pool().map(q=>q.id),old);state.index=0;state.round++;toast(`${tr('第 {round} 轮完成，开始新一轮练习',{round:state.round-1})}`);}state.hint=false;state.answer=false;renderQuestion(true);}
function toggleReveal(which){
  if(!current())return;state[which]=!state[which];const button=$(`#${which}-toggle`),content=$(`#${which}-content`);button.setAttribute('aria-expanded',String(state[which]));button.querySelector('.trailing').innerHTML=`${state[which]?(which==='hint'?tr("收起提示"):tr("收起答案")):(which==='hint'?tr("点击展开"):tr("想好再看"))}${icon('down')}`;content.hidden=!state[which];
}
$('#app').addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');if(!button||button.disabled)return;const action=button.dataset.action;
  if(action.startsWith('nav-')){changeView(action==='nav-practice'?'practice':'library');return;}
  if(action==='toggle-sidebar'||action==='toggle-filters'){
    const key=action==='toggle-sidebar'?'sidebarCollapsed':'filtersCollapsed';
    state[key]=!state[key];render();$(`[data-action="${action}"]`)?.focus({preventScroll:true});return;
  }
  if(action==='theme-menu'||action==='language-menu'){const key=action==='theme-menu'?'themeMenu':'languageMenu';const open=!state[key];state.themeMenu=false;state.languageMenu=false;state[key]=open;render();$(`[data-action="${action}"]`)?.focus({preventScroll:true});return;}
  if(action==='set-language'){setLanguage(button.dataset.value);state.languageMenu=false;try{localStorage.setItem(languageKey,getLanguage());}catch{toast(tr('语言已切换，浏览器当前无法保存偏好。'));}render();$('[data-action="language-menu"]').focus({preventScroll:true});return;}
  if(action==='set-theme'){state.theme=button.dataset.value;state.themeMenu=false;try{localStorage.setItem('zhijian-theme',state.theme);}catch{toast(tr("主题已切换，浏览器当前无法保存偏好。"));}applyTheme();render();return;}
  if(['toggle-tag','all-tags','reset-filters','match-any','match-all'].includes(action)){
    if(action==='toggle-tag'){const tag=button.dataset.tag;state.tags=state.tags.includes(tag)?state.tags.filter(t=>t!==tag):[...state.tags,tag];}
    else if(action==='match-any'||action==='match-all')state.match=action==='match-any'?'any':'all';else {state.tags=[];if(action==='reset-filters')state.match='any';}
    resetDeck();render();const equivalent=action==='toggle-tag'?[...document.querySelectorAll('[data-action="toggle-tag"]')].find(b=>b.dataset.tag===button.dataset.tag):document.querySelector(`[data-action="${action}"]`);equivalent?.focus({preventScroll:true});return;
  }
  if(action==='next')nextQuestion();
  else if(action==='previous'&&state.index>0){state.index--;state.hint=false;state.answer=false;renderQuestion(true);}
  else if(action==='toggle-hint')toggleReveal('hint');
  else if(action==='toggle-answer')toggleReveal('answer');
  else if(action==='new-question')openQuestion();
  else if(action==='edit-current')openQuestion(current()?.id);
  else if(action==='edit-question')openQuestion(button.dataset.id);
  else if(action==='delete-question')openDelete(button.dataset.id);
  else if(action==='import')openImport();
  else if(action==='import-guide')openImport(true);
  else if(action==='export')openExport();
  else if(action==='recovery-export')download(rawRecovery,'quiz-原始数据备份.json','application/json');
  else if(action==='clear-search'){state.search='';state.page=1;$('#library-search').value='';button.hidden=true;renderLibraryList();$('#library-search').focus();}
  else if(action==='clear-library-filters'){state.search='';state.libraryTag='';state.page=1;render();$('#library-search')?.focus();}
  else if(action==='page-prev'||action==='page-next'){state.page+=action==='page-next'?1:-1;renderLibraryList();$('#library-list').scrollIntoView({behavior:'smooth',block:'start'});}
  else if(action==='delete-samples'){
    const removed=state.questions.filter(isSampleQuestion);
    if(removed.length&&saveBank(state.questions.filter(q=>!isSampleQuestion(q)))){render();toast(tr("已删除 {count} 道示例题目",{count:removed.length}),tr("撤销"),()=>{const ids=new Set(state.questions.map(q=>q.id));const restored=removed.filter(q=>!ids.has(q.id));if(saveBank([...state.questions,...restored]))render();});}
  }
  else if(action==='load-samples'&&!state.questions.length){if(saveBank(mergeQuestions(state.questions,seedQuestions).questions)){render();toast(tr("已载入 12 道示例题目"));}}
});
$('#app').addEventListener('input',e=>{if(e.target.id==='library-search'){state.search=e.target.value;state.page=1;$('.search-clear').hidden=!state.search;renderLibraryList();}});
$('#app').addEventListener('change',e=>{
  if(e.target.id==='library-tag'){state.libraryTag=e.target.value;state.page=1;renderLibraryList();}
});
$('#dialogs').addEventListener('click',e=>{
  const button=e.target.closest('[data-dialog-action]');if(!button||button.disabled)return;const action=button.dataset.dialogAction;
  if(action==='close'){closeDialog();return;}
  if(action==='remove-tag'){formTags.splice(Number(button.dataset.index),1);renderFormTags();$('#tag-input').focus();}
  else if(action==='choose-file'){$('#import-file').value='';$('#import-file').click();}
  else if(action==='reselect')openImport();
  else if(action==='template-json'||action==='template-csv'){const isCSV=action.endsWith('csv');const q=[{question:tr("光年是什么单位？"),hint:tr("想想光走过的距离。"),answer:tr("距离单位，表示光在真空中传播一年经过的距离。"),tags:[tr("科学"),tr("常识")]}];download(isCSV?exportCSV(q):exportJSON(q),`quiz题库模板.${isCSV?'csv':'json'}`,isCSV?'text/csv;charset=utf-8':'application/json;charset=utf-8');toast(tr("已下载题库模板"));}
  else if(action==='export-json'||action==='export-csv')exportBank(action.endsWith('csv')?'csv':'json');
  else if(action==='confirm-delete'){
    const id=button.dataset.id,q=state.questions.find(q=>q.id===id),index=state.questions.findIndex(q=>q.id===id);if(!q)return;
    if(saveBank(state.questions.filter(q=>q.id!==id))){closeDialog();render();toast(tr("题目已删除"),tr("撤销"),()=>{const restored=[...state.questions];if(restored.some(x=>x.id===q.id))return;restored.splice(Math.min(index,restored.length),0,q);if(saveBank(restored)){render();toast(tr("已恢复这道题目"));}});}
  }else if(action==='confirm-import'&&pendingImport){
    const p=pendingImport,result=mergeQuestions(state.questions,p.valid,p.replace),previousRaw=rawRecovery;
    if(rawRecovery&&!p.replace){$('#import-error').textContent=tr("原有数据无法读取，请先导出原始备份，再选择替换整个题库。");return;}
    if(p.replace)rawRecovery='';
    if(saveBank(result.questions)){closeDialog();pendingImport=null;state.page=1;state.search='';state.libraryTag='';state.view='library';render();toast(`${tr(p.replace?"已替换并导入 {count} 道题目":"已导入 {count} 道题目",{count:result.added})}${result.duplicates?`${tr('，跳过 {count} 道重复题目',{count:result.duplicates})}`:''}`);}else rawRecovery=previousRaw;
  }
});
$('#dialogs').addEventListener('submit',e=>{
  if(e.target.id!=='question-form')return;e.preventDefault();if(!collectTags())return;
  const data=new FormData(e.target);let q;try{q=normalizeQuestion({question:data.get('question'),hint:data.get('hint'),answer:data.get('answer'),tags:formTags});}catch(err){$('#form-error').textContent=err.message;return;}
  const editing=!!formId;q.id=formId||uid();q.updatedAt=new Date().toISOString();const next=editing?state.questions.map(old=>old.id===formId?q:old):[q,...state.questions];
  if(saveBank(next)){resetDeck(q.id);closeDialog();render();toast(editing?tr("题目已更新"):tr("新题目已保存"));}
});
$('#dialogs').addEventListener('keydown',e=>{if(e.target.id==='tag-input'&&e.key==='Enter'){e.preventDefault();collectTags();}});
$('#dialogs').addEventListener('change',e=>{if(e.target.name==='import-mode'&&pendingImport){pendingImport.replace=e.target.value==='replace';showImportPreview();const r=document.querySelector(`input[name="import-mode"][value="${pendingImport.replace?'replace':'append'}"]`);r?.focus({preventScroll:true});}});
$('#import-file').addEventListener('change',e=>readFile(e.target.files[0]));
document.addEventListener('click',e=>{if((state.themeMenu||state.languageMenu)&&!e.target.closest('[data-action="theme-menu"],[data-action="language-menu"],.menu-popover')){state.themeMenu=false;state.languageMenu=false;$('.menu-popover')?.remove();document.querySelectorAll('[data-action="theme-menu"],[data-action="language-menu"]').forEach(button=>button.setAttribute('aria-expanded','false'));}});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&(state.themeMenu||state.languageMenu)){const action=state.languageMenu?'language-menu':'theme-menu';state.themeMenu=false;state.languageMenu=false;$('.menu-popover')?.remove();$(`[data-action="${action}"]`)?.setAttribute('aria-expanded','false');$(`[data-action="${action}"]`)?.focus();return;}
  if(state.view!=='practice'||$('#dialogs dialog')||state.themeMenu||state.languageMenu||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;
  if(e.target.closest('input,textarea,select,button,a,[contenteditable="true"]'))return;
  if(e.code==='Space'){e.preventDefault();toggleReveal('answer');}else if(e.key.toLowerCase()==='h'){e.preventDefault();toggleReveal('hint');}else if(e.key==='ArrowRight'){e.preventDefault();nextQuestion();}else if(e.key==='ArrowLeft'&&state.index>0){e.preventDefault();state.index--;state.hint=false;state.answer=false;renderQuestion(true);}
});
window.addEventListener('storage',e=>{if(e.key===KEY&&e.newValue!==null){try{const parsed=JSON.parse(e.newValue);if(!Array.isArray(parsed.questions))return;const next=parsed.questions.map(q=>({...normalizeQuestion(q),id:q.id||uid()}));state.questions=next;state.tags=state.tags.filter(t=>allTags().includes(t));resetDeck();if(!$('#dialogs dialog'))render();toast(tr("题库已与另一个标签页的修改同步"));}catch{toast(tr("另一个标签页的数据无法读取，请刷新检查。"));}}else if(e.key==='zhijian-theme'){state.theme=['light','dark','system'].includes(e.newValue)?e.newValue:'system';applyTheme();if(!$('#dialogs dialog'))render();}});
render();
