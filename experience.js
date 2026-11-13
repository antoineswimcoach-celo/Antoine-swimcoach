/* Public site interactions. */
(function(){
  'use strict';
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const screen=document.getElementById('waterScreen');
  let loadingTimer=null,hideTimer=null;
  function hideLoader(){
    clearTimeout(loadingTimer);clearTimeout(hideTimer);
    screen.classList.add('leaving');
    hideTimer=setTimeout(()=>{screen.hidden=true;screen.classList.remove('leaving');},reduced.matches?0:350);
  }
  function showLoader(demo){
    clearTimeout(loadingTimer);clearTimeout(hideTimer);
    screen.classList.remove('leaving');screen.hidden=false;
    document.getElementById('waterScreenLabel').textContent=document.body.dataset.loaderKind==='drop'?'Une goutte. Un nouvel élan.':'Prenez une inspiration.';
    loadingTimer=setTimeout(hideLoader,demo?2300:4500);
  }
  window.waterLoadingMarkup=function(title,detail){
    const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return '<div class="water-loading" role="status" aria-live="polite"><div class="water-motion" aria-hidden="true"><span class="water-drop"></span><span class="water-ripple r1"></span><span class="water-ripple r2"></span></div><strong>'+escape(title)+'</strong><small>'+escape(detail)+'</small></div>';
  };
  document.getElementById('loaderSkip').addEventListener('click',hideLoader);
  // Initial overlay follows the real load event; it never imposes a minimum wait.
  if(document.readyState!=='complete'){
    showLoader(false);window.addEventListener('load',hideLoader,{once:true});
  }

  const menu=document.getElementById('siteNav'),toggle=document.getElementById('menuToggle');
  function closeMenu(){menu.classList.remove('open');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Ouvrir le menu');}
  toggle.addEventListener('click',()=>{
    const isOpen=toggle.getAttribute('aria-expanded')==='true';
    toggle.setAttribute('aria-expanded',String(!isOpen));toggle.setAttribute('aria-label',isOpen?'Ouvrir le menu':'Fermer le menu');menu.classList.toggle('open',!isOpen);
  });
  menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMenu();if(!screen.hidden)hideLoader();}});
  const header=document.getElementById('siteHeader');
  let scrollPending=false;
  window.addEventListener('scroll',()=>{if(scrollPending)return;scrollPending=true;requestAnimationFrame(()=>{header.classList.toggle('is-scrolled',window.scrollY>20);scrollPending=false;});},{passive:true});

  if('IntersectionObserver'in window&&!reduced.matches){
    document.documentElement.classList.add('has-motion');
    const reveal=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');reveal.unobserve(entry.target);}}),{threshold:.07,rootMargin:'0px 0px 30px 0px'});
    document.querySelectorAll('.reveal').forEach(node=>reveal.observe(node));
  }
  const mobile=document.getElementById('mobileBook');
  if('IntersectionObserver'in window){new IntersectionObserver(entries=>{entries.forEach(entry=>mobile.classList.toggle('is-hidden',entry.isIntersecting));},{threshold:0}).observe(document.getElementById('reserver'));}

  function choose(id){const field=document.getElementById(id);if(!field)return;field.checked=true;field.dispatchEvent(new Event('change',{bubbles:true}));}
  function goBooking(){document.getElementById('reserver').scrollIntoView({behavior:reduced.matches?'auto':'smooth',block:'start'});}
  document.querySelectorAll('[data-orient]').forEach(button=>button.addEventListener('click',()=>{choose(button.dataset.person);choose(button.dataset.orient);goBooking();}));
  document.querySelectorAll('[data-profile]').forEach(button=>button.addEventListener('click',()=>{choose(button.dataset.profile);if(button.dataset.format)choose(button.dataset.format);goBooking();}));
  document.querySelectorAll('[data-child-age]').forEach(button=>button.addEventListener('click',()=>{
    const over=button.dataset.childAge==='over';
    document.querySelectorAll('[data-child-age]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    document.getElementById('childPrice').innerHTML=(over?'55':'27,50')+' <span>€ <small>/ séance</small></span>';
    document.getElementById('childDuration').textContent=over?'1 heure adaptée à son niveau':'30 minutes adaptées à son âge';
    document.getElementById('childPackPrice').textContent=over?'5 séances : 260 € · 10 séances : 500 €':'5 séances : 130 € · 10 séances : 250 €';
    document.getElementById('childPriceCta').dataset.profile=over?'child8':'childu8';
  }));
  const stepLabel=document.getElementById('wizardStepLabel');
  new MutationObserver(()=>{
    const current=Number(stepLabel.textContent.match(/\d+/)?.[0]||1);
    document.querySelectorAll('[data-journey]').forEach(node=>{node.classList.toggle('active',Number(node.dataset.journey)===current);node.classList.toggle('complete',Number(node.dataset.journey)<current);});
  }).observe(stepLabel,{childList:true,subtree:true,characterData:true});

  const contact=document.getElementById('contactDialog');
  document.querySelectorAll('[data-open-contact]').forEach(button=>button.addEventListener('click',()=>contact.showModal()));
  document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
  document.getElementById('copyEmail').addEventListener('click',async()=>{
    const feedback=document.getElementById('copyEmailFeedback');
    try{await navigator.clipboard.writeText('antoineswimcoach@gmail.com');feedback.textContent='Adresse copiée.';}
    catch(error){feedback.textContent='Sélectionnez l’adresse ci-dessus pour la copier.';}
  });
  document.querySelectorAll('.faq-accordion details').forEach(details=>details.addEventListener('toggle',()=>{if(details.open)document.querySelectorAll('.faq-accordion details').forEach(other=>{if(other!==details)other.open=false;});}));
})();
