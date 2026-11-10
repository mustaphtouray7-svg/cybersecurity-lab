const params=new URLSearchParams(location.search);
const token=params.get('token');
const valid=!!token&&/^[A-Za-z0-9_-]{20,80}$/.test(token);
const form=document.querySelector('#share-email');
const skip=document.querySelector('#skip');
const status=document.querySelector('#status');
const shareButton=document.querySelector('#share-button');
const emailChoice=document.querySelector('#email-choice');
if(!valid){
  document.querySelector('h1').textContent='Invalid visit link';
  document.querySelector('.intro').textContent='This visit link is missing or invalid.';
  shareButton.remove();skip.remove();
}else{
  skip.href='/api/visitor/continue?token='+encodeURIComponent(token);
  shareButton.addEventListener('click',()=>{
    emailChoice.hidden=false;
    shareButton.hidden=true;
    document.querySelector('#email').focus();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const email=document.querySelector('#email').value.trim();
    const button=form.querySelector('button');
    button.disabled=true;status.textContent='Submitting…';
    try{
      const response=await fetch('/api/visitor/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,email})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not save email.');
      location.href=data.destination;
    }catch(error){status.textContent=error.message;button.disabled=false;}
  });
}
