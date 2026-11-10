const status=document.querySelector('#status');
const rows=document.querySelector('#visitors');
const loginPanel=document.querySelector('#login-panel');
const adminContent=document.querySelector('#admin-content');
function addCell(row,value){const cell=document.createElement('td');cell.textContent=value||'Not available';row.append(cell);}
function inferDeviceDetails(ua=''){
 const browser=/Edg\//.test(ua)?'Microsoft Edge':/OPR\//.test(ua)?'Opera':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)&&!/Chrome\//.test(ua)?'Safari':'Not available';
 const os=/Android/.test(ua)?'Android':/iPhone|iPad|iPod/.test(ua)?'iOS':/Windows/.test(ua)?'Windows':/Mac OS/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'Not available';
 const device=/iPad|Tablet/.test(ua)?'Tablet':/Mobi|Android/.test(ua)?'Mobile':ua?'Desktop':'Not available';
 return {browser,os,device};
}
async function loadVisitors(){
 try{
  const response=await fetch('/api/admin/visitors');
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Could not load visits');
  const list=data.visitors||[];
  rows.replaceChildren();
  document.querySelector('#total-visits').textContent=list.length;
  document.querySelector('#shared-emails').textContent=list.filter(x=>x.email_shared).length;
  document.querySelector('#mobile-visits').textContent=list.filter(x=>x.device_type==='Mobile').length;
  document.querySelector('#desktop-visits').textContent=list.filter(x=>x.device_type==='Desktop').length;
  if(!list.length){const row=document.createElement('tr');const cell=document.createElement('td');cell.colSpan=9;cell.textContent='No visits recorded yet.';row.append(cell);rows.append(row);return;}
  for(const item of list){
   const row=document.createElement('tr');
   const inferred=inferDeviceDetails(item.user_agent||'');
   addCell(row,new Date(item.visited_at).toLocaleString());
   addCell(row,item.email_shared?item.email:'Not shared');
   addCell(row,item.device_type||inferred.device);
   addCell(row,item.os_info||inferred.os);
   addCell(row,item.browser_info||inferred.browser);
   addCell(row,[item.language,item.timezone].filter(Boolean).join(' / '));
   addCell(row,[item.screen_size,item.viewport_size].filter(Boolean).join(' / '));
   addCell(row,item.destination);
   addCell(row,item.referrer);
   rows.append(row);
  }
 }catch(error){status.textContent=error.message;}
}
async function load(){
 try{
  const me=await fetch('/api/admin/me').then(response=>response.json());
  loginPanel.hidden=me.authenticated;adminContent.hidden=!me.authenticated;
  if(me.authenticated)await loadVisitors();
 }catch(error){status.textContent=error.message;}
}
document.querySelector('#login-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const output=document.querySelector('#login-status');
 try{
  const response=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.querySelector('#admin-password').value})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Login failed');
  document.querySelector('#admin-password').value='';
  await load();
 }catch(error){output.textContent=error.message;}
});
document.querySelector('#refresh').addEventListener('click',loadVisitors);
document.querySelector('#logout').addEventListener('click',async()=>{await fetch('/api/admin/logout',{method:'POST'});await load();});
document.querySelector('#create-link').addEventListener('submit',async event=>{
 event.preventDefault();
 const output=document.querySelector('#new-link');
 try{
  const response=await fetch('/api/admin/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destination:document.querySelector('#destination').value})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Could not create link');
  output.textContent='Tracking link: '+result.url;
  document.querySelector('#destination').value='';
 }catch(error){output.textContent=error.message;}
});
load();
