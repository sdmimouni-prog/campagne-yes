import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const local=process.argv.includes('--local');
const vendorOnly=process.argv.includes('--vendor-only');
const output=resolve(root,'dist');
const files=[
  'index.html','styles.css','app.js','dashboard.html','dashboard.css','dashboard.js',
  'dashboard-charts.css','dashboard-charts.js','dashboard-data.js','reporting-data.js',
  'gestion-campagnes.html','gestion-campagnes.css','gestion-campagnes.js','portal-service.js'
];

export function publicConfig(environment, localMode=false) {
  if(localMode) {
    if(environment.VERCEL)throw new Error('Le mode local est interdit pour un déploiement Vercel.');
    return {backend:'local',supabaseUrl:'',supabasePublishableKey:'',clientId:'yes-baby'};
  }
  const supabaseUrl=(environment.SUPABASE_URL||'').trim();
  const supabasePublishableKey=(environment.SUPABASE_PUBLISHABLE_KEY||'').trim();
  const clientId=(environment.PORTAL_CLIENT_ID||'yes-baby').trim();
  let url;
  try{url=new URL(supabaseUrl);}catch{throw new Error('SUPABASE_URL est manquante ou invalide.');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('SUPABASE_URL doit être l’URL HTTPS du projet Supabase.');
  let publicKey=supabasePublishableKey.startsWith('sb_publishable_')&&supabasePublishableKey.length>20;
  if(supabasePublishableKey.startsWith('eyJ')) {
    try{publicKey=JSON.parse(Buffer.from(supabasePublishableKey.split('.')[1],'base64url').toString()).role==='anon';}catch{publicKey=false;}
  }
  if(!publicKey)throw new Error('SUPABASE_PUBLISHABLE_KEY doit contenir une clé publique Publishable ou anon, jamais une clé secret/service_role.');
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(clientId))throw new Error('PORTAL_CLIENT_ID est invalide.');
  return {backend:'supabase',supabaseUrl:url.origin,supabasePublishableKey,clientId};
}

async function writeVendor(target) {
  await mkdir(dirname(target),{recursive:true});
  await bundle({stdin:{contents:"export { createClient } from '@supabase/supabase-js';",resolveDir:root,sourcefile:'supabase-entry.js'},outfile:target,bundle:true,platform:'browser',format:'esm',target:['es2022'],minify:true,legalComments:'linked'});
  const license=await readFile(resolve(root,'node_modules/@supabase/supabase-js/LICENSE'),'utf8');
  await writeFile(resolve(dirname(target),'SUPABASE-LICENSE.txt'),license);
}

async function main() {
  if(vendorOnly){await writeVendor(resolve(root,'vendor/supabase.js'));console.log('SDK Supabase préparé pour le serveur local.');return;}
  // Validate before clearing output. A missing cloud configuration must fail a deployment.
  const config=publicConfig(process.env,local);
  await rm(output,{recursive:true,force:true});
  await mkdir(output,{recursive:true});
  for(const name of files)await cp(resolve(root,name),resolve(output,name));
  await cp(resolve(root,'assets'),resolve(output,'assets'),{recursive:true});
  await writeFile(resolve(output,'portal-config.js'),`// Public configuration. No server secret belongs here.\nexport default Object.freeze(${JSON.stringify(config,null,2)});\n`);
  await writeVendor(resolve(output,'vendor/supabase.js'));
  await writeFile(resolve(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
  console.log(`Build terminé : dist/ · mode ${config.backend}.`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
