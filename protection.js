import {isMissing,numberOf} from './engine.js';
// Compare the current working copy with a proposed plan; never change either.
export function assessProtection(source, preview, rule, options) {
 const messages=[], warnings=[];
 const add=(text,warn=false)=>{messages.push(text);if(warn)warnings.push(text);};
 const gi=source.headers.indexOf(rule.group), ni=source.headers.indexOf(rule.numeric);
 const removed=new Set(preview.removed.map(r=>r.record-2));
 const norm=v=>String(v??'').trim();
 if(gi>=0){
  const members=source.rows.map((r,i)=>norm(r[gi])===rule.value?i:-1).filter(i=>i>=0);
  const lost=members.filter(i=>removed.has(i)).length;
  if(!members.length)add('No records match the protected value. Choose a value from this dataset.',true);
  else {const loss=100*lost/members.length;add(`${rule.group} = ${rule.value}: ${members.length} original records; ${lost} would be removed (${loss.toFixed(1)}%). Your limit is ${rule.maxLoss}%.`,loss>rule.maxLoss);}
  const next=preview.dataset.headers.indexOf(rule.group);
  if(next<0)add(`The protected column ${rule.group} would be dropped.`,true);
  else if(members.length){const remaining=preview.dataset.rows.filter(r=>norm(r[next])===rule.value).length;add(`Matching records after all transformations: ${remaining}. Counts may change through edits as well as removal.`);}
 }
 const values=(data,index)=>data.rows.map(r=>isMissing(r[index],options.missingTokens)?null:numberOf(r[index])).filter(v=>v!==null);
 const mean=v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
 if(ni>=0){
  const next=preview.dataset.headers.indexOf(rule.numeric);
  if(next<0)add(`The watched numeric column ${rule.numeric} would be dropped.`,true);
  else {const a=values(source,ni),b=values(preview.dataset,next),before=mean(a),after=mean(b);
   if(before===null||after===null)add('Cannot compare the average: valid numeric values are missing.',true);
   else {const shift=before===0?(after===0?0:null):Math.abs((after-before)/before)*100;
    add(`${rule.numeric} average: ${before.toPrecision(5)} → ${after.toPrecision(5)} (${a.length} → ${b.length} valid values).`);
    add(shift===null?'Percentage change is undefined because the original average is zero.':`Average changes by ${shift.toFixed(1)}%; your limit is ${rule.maxShift}%.`,shift===null||shift>rule.maxShift);
   }
   if(gi>=0&&preview.dataset.headers.includes(rule.group)){
    const leaders=(data,g,n)=>{const groups=new Map();for(const r of data.rows){const key=norm(r[g]);if(isMissing(key,options.missingTokens)||isMissing(r[n],options.missingTokens))continue;const v=numberOf(r[n]);if(v===null)continue;const x=groups.get(key)||[0,0];x[0]+=v;x[1]++;groups.set(key,x);}const scores=[...groups].map(([key,[sum,count]])=>[key,sum/count]);if(!scores.length)return [];const best=Math.max(...scores.map(x=>x[1]));return scores.filter(x=>Math.abs(x[1]-best)<=Math.max(1,Math.abs(best))*1e-10).map(x=>x[0]).sort();};
    const a=leaders(source,gi,ni),b=leaders(preview.dataset,preview.dataset.headers.indexOf(rule.group),next);
    if(a.length&&b.length)add(`Highest group average: ${a.join(', ')} → ${b.join(', ')}.`,JSON.stringify(a)!==JSON.stringify(b));
   }
  }
 }
 return {messages,warnings,rule:{...rule},checkedAt:new Date().toISOString()};
}

// Retention-only alternative: restore the fewest original group members needed
// for the removal limit. Ties use input order, never an inferred quality score.
export function retentionSuggestion(source, preview, rule) {
 const index=source.headers.indexOf(rule.group);
 if(index<0||!rule.value||!preview.dataset.headers.includes(rule.group))return null;
 const matches=row=>String(row[index]??'').trim()===rule.value;
 const total=source.rows.filter(matches).length;
 const candidates=preview.removed.filter(item=>matches(source.rows[item.record-2]));
 const permitted=Math.floor(total*Number(rule.maxLoss)/100+1e-9);
 const needed=Math.max(0,candidates.length-permitted);
 if(!needed)return null;
 return {total,needed,records:candidates.slice(0,needed).map(item=>({record:item.record,reason:item.reason})),beforeRemoved:preview.removed.length};
}
export function buildRetentionAlternative(source, preview, rule, options) {
 const suggestion=retentionSuggestion(source,preview,rule);
 if(!suggestion)throw Error('No retention alternative is needed for this preview.');
 const rescued=new Set(suggestion.records.map(item=>item.record));
 const removed=preview.removed.filter(item=>!rescued.has(item.record));
 const excluded=new Set(removed.map(item=>item.record-2));
 const rows=source.rows.map(row=>[...row]);
 const columnIndex=new Map(source.headers.map((name,index)=>[name,index]));
 for(const edit of preview.changes)rows[edit.record-2][columnIndex.get(edit.column)]=edit.after;
 const retained=preview.dataset.headers.map(name=>columnIndex.get(name));
 const result={...preview,dataset:{...preview.dataset,rows:rows.filter((_,index)=>!excluded.has(index)).map(row=>retained.map(index=>row[index]))},removed,keptRows:source.rows.length-removed.length,
  audit:[...preview.audit,`Retention alternative overrides row removal for records ${suggestion.records.map(item=>item.record).join(', ')} to meet the ${rule.maxLoss}% removal limit for ${rule.group} = ${rule.value}. These records may still be duplicates, missing labels, or unusual readings.`],
  retentionAlternative:suggestion};
 result.protection=assessProtection(source,result,rule,options);
 return result;
}
