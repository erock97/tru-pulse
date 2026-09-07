import {describe,it,expect} from 'vitest';
import worker from './index.js';
import type {Env} from './env.js';
describe('preference browser preflight',()=>{
 it.each(['/data/preferences','/data/personal-profile'])('allows PUT from the actual app origin for %s',async(path)=>{
  const request=new Request(`https://api.truhq.co${path}`,{method:'OPTIONS',headers:{Origin:'https://app.truhq.co','Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-type'}});
  const response=await worker.fetch(request,{SUPABASE_URL:'https://database.example',SUPABASE_SERVICE_ROLE_KEY:'test-only'} as Env,{} as ExecutionContext);
  expect(response.status).toBe(204);
  if(path==='/data/personal-profile')expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  expect(response.headers.get('Access-Control-Allow-Methods')?.split(',').map(s=>s.trim())).toContain('PUT');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.truhq.co');
  expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
 });
});
