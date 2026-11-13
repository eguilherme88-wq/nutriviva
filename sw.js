'use strict';
// This demo intentionally does not cache pages, clinical records, or authentication.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin || !url.pathname.startsWith('/nutriviva/'))return;
  if(event.request.method!=='GET'||event.request.mode!=='navigate')return;
  event.respondWith(fetch(event.request).catch(()=>new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NutriViva — Sem conexão</title><style>body{margin:0;background:#f7f8f2;color:#193d32;font:16px Arial,sans-serif;display:grid;place-items:center;min-height:100vh}main{max-width:400px;margin:24px;padding:35px;border:1px solid #dfe7d9;border-radius:20px;background:white}h1{font-size:26px}p{line-height:1.7;color:#65776a}a{display:inline-block;padding:13px 20px;background:#285c4c;color:white;border-radius:10px;text-decoration:none}</style></head><body><main><h1>NutriViva</h1><h2>Sem conexão no momento</h2><p>Conecte o aparelho à internet para abrir o consultório. Esta versão não guarda uma cópia das páginas para acesso sem conexão.</p><a href="./#painel">Tentar novamente</a></main></body></html>`,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
