import test from 'node:test';
import assert from 'node:assert/strict';
import { publicConfig } from '../scripts/build.mjs';

const settings={SUPABASE_URL:'https://example-project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example_public_key',PORTAL_CLIENT_ID:'yes-baby'};
const jwt=role=>['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({role})).toString('base64url'),'signature'].join('.');

test('cloud build requires configuration and refuses privileged credentials',()=>{
  assert.throws(()=>publicConfig({}),/SUPABASE_URL/);
  assert.throws(()=>publicConfig({...settings,SUPABASE_PUBLISHABLE_KEY:'sb_secret_do_not_publish'}),/clé publique/);
  assert.throws(()=>publicConfig({...settings,SUPABASE_PUBLISHABLE_KEY:jwt('service_role')}),/clé publique/);
  assert.equal(publicConfig({...settings,SUPABASE_PUBLISHABLE_KEY:jwt('anon')}).backend,'supabase');
});
test('local preview cannot be deployed as a Vercel production build',()=>{
  assert.throws(()=>publicConfig({VERCEL:'1'},true),/interdit/);
  assert.equal(publicConfig({},true).backend,'local');
});
test('generated configuration only exposes permitted public settings',()=>{
  const result=publicConfig({...settings,SUPABASE_SECRET_KEY:'secret-not-for-browser',DATABASE_URL:'password-not-for-browser'});
  assert.deepEqual(Object.keys(result).sort(),['backend','clientId','supabasePublishableKey','supabaseUrl']);
  assert.equal(JSON.stringify(result).includes('not-for-browser'),false);
  assert.throws(()=>publicConfig({...settings,SUPABASE_URL:'http://example-project.supabase.co'}),/HTTPS/);
  assert.throws(()=>publicConfig({...settings,SUPABASE_URL:'https://user:password@example-project.supabase.co'}),/HTTPS/);
});
